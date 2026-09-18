#!/usr/bin/env bash
# The command the project runner container is created with. Fixed at creation;
# the panel supplies no argument. The request is { verb, project, flags } in
# state/runner/request.json, plus { workingDir, configFiles } for an `up` of a
# project that has no container left. See docs/development/adr/0030-the-panel-and-a-project-lifecycle.md.
set -euo pipefail

PORTTA_ROOT="${PORTTA_ROOT:?PORTTA_ROOT is required}"
REQUEST="$PORTTA_ROOT/state/runner/request.json"
HOST_ROOT=/host

die() { printf 'error: %s\n' "$1" >&2; exit 1; }

[ -f "$REQUEST" ] || die "no runner request at $REQUEST"

# Closed fields, closed values. A full JSON parser is not needed and would be a
# dependency this image does not have. The panel refuses a path carrying a
# comma, a quote or a backslash before it writes the request, which is what
# lets the list be read as text between the brackets.
verb=$(sed -n 's/.*"verb"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$REQUEST" | head -n1)
project=$(sed -n 's/.*"project"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$REQUEST" | head -n1)
nocache=$(grep -q '"no-cache"' "$REQUEST" && printf '1' || printf '0')
directory=$(grep -q '"directory"' "$REQUEST" && printf '1' || printf '0')
request_working_dir=$(sed -n 's/.*"workingDir"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$REQUEST" | head -n1)
request_config_files=$(sed -n 's/.*"configFiles"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p' "$REQUEST" | head -n1 | tr -d '"')

case "$verb" in
  up|stop|restart|build|down|down-volumes) ;;
  *) die "unknown runner verb '$verb'" ;;
esac

[[ "$project" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "refusing project name '$project'"

# The bound a path from the request must satisfy, the same one
# packages/core/src/runner.ts checks before writing it: absolute, no walk-up,
# not `/`, not a top-level directory.
assert_request_path() {
  local path="$1" what="$2"
  [[ "$path" == /* ]] || die "$what is not absolute"
  [[ "$path" != *..* ]] || die "refusing $what that walks up"
  [[ "$path" != "/" ]] || die "refusing / as $what"
  case "${path#/}" in
    */*) ;;
    *) die "refusing a top-level directory as $what" ;;
  esac
}

# With no container left there is no managed label to protect Portta itself.
# Refuse both its root and descendants: a remembered request must never run a
# consumer Compose file from the gateway checkout.
assert_not_portta_path() {
  local path="$1" what="$2"
  case "$path" in
    "$PORTTA_ROOT"|"$PORTTA_ROOT"/*) die "refusing Portta's own directory as $what" ;;
  esac
}

id=$(docker ps -aq --filter "label=com.docker.compose.project=${project}" | head -n1)
if [ -n "$id" ]; then
  # A container exists: its labels are the truth, whatever the request says.
  managed=$(docker inspect "$id" --format '{{ index .Config.Labels "portta.managed" }}' 2>/dev/null || true)
  [ "$managed" != "true" ] || die "refusing to operate Portta's own project"
  working_dir=$(docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}')
  config_files=$(docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}')
else
  # Nothing left to read labels from: only `up` makes sense, and only with the
  # paths the panel remembered. Portta's own project is refused by name and by
  # directory, since no label can say so here.
  [ "$verb" = "up" ] || die "no container on this host belongs to project '$project'"
  [ -n "$request_working_dir" ] || die "no container on this host belongs to project '$project', and the request names no working directory"
  own_name=$(sed -n 's/^PORTTA_PROJECT_NAME=//p' "$PORTTA_ROOT/.env" 2>/dev/null | head -n1)
  own_name="${own_name%\"}"; own_name="${own_name#\"}"; own_name="${own_name%\'}"; own_name="${own_name#\'}"
  own_name="${own_name:-portta}"
  [ "$project" != "$own_name" ] || die "refusing to operate Portta's own project"
  assert_request_path "$request_working_dir" "working directory"
  assert_not_portta_path "$request_working_dir" "a working directory"
  working_dir="$request_working_dir"
  config_files="$request_config_files"
fi

[ -n "$working_dir" ] || die "project '$project' has no Compose working directory label"
[ -d "${HOST_ROOT}${working_dir}" ] || die "working directory ${working_dir} does not exist on this host"

# Compose sees the host filesystem at the host's own paths, so `include:` and
# every relative path in a Compose file resolve exactly as they do on the host.
# The first ancestor of a path that does not exist in this container becomes a
# symlink into /host; the repository root is already mounted at its own path.
link_host_path() {
  local target="$1" partial="" rest segment
  case "$target" in
    "$PORTTA_ROOT"|"$PORTTA_ROOT"/*) return 0 ;;
  esac
  rest="${target#/}"
  while [ -n "$rest" ]; do
    segment="${rest%%/*}"
    if [ "$segment" = "$rest" ]; then rest=""; else rest="${rest#*/}"; fi
    partial="$partial/$segment"
    if [ -L "$partial" ]; then
      [ "$(realpath "$partial")" = "$(realpath "${HOST_ROOT}${partial}")" ] || die "${partial} in the runner does not point at the host's ${partial}; recreate the runner with portta up"
      return 0
    fi
    if [ ! -e "$partial" ]; then
      ln -s "${HOST_ROOT}${partial}" "$partial"
      return 0
    fi
  done
  [ "$(realpath "$target")" = "$(realpath "${HOST_ROOT}${target}")" ] || die "${target} exists inside the runner image and is not the host's ${target}"
}

link_host_path "$working_dir"

# Compose files as the daemon recorded them, or as the panel remembered them.
# Readability is checked through /host; the path handed to Compose is the
# host's, like --project-directory, so bind mounts resolve on the host.
files=()
if [ -n "$config_files" ]; then
  IFS=',' read -r -a listed <<< "$config_files"
  for file in "${listed[@]}"; do
    file="${file#"${file%%[![:space:]]*}"}"
    file="${file%"${file##*[![:space:]]}"}"
    [ -n "$file" ] || continue
    [ -z "$id" ] && assert_request_path "$file" "compose file"
    [ -n "$id" ] || assert_not_portta_path "$file" "a compose file"
    [ -f "${HOST_ROOT}${file}" ] || die "compose file ${file} is not readable"
    case "$file" in
      "$working_dir"/*) ;;
      *) link_host_path "${file%/*}" ;;
    esac
    files+=(-f "$file")
  done
fi
if [ ${#files[@]} -eq 0 ]; then
  for name in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
    if [ -f "${HOST_ROOT}${working_dir}/${name}" ]; then
      files+=(-f "${working_dir}/${name}")
      break
    fi
  done
fi
[ ${#files[@]} -gt 0 ] || die "no compose file in ${working_dir}"

compose() {
  docker compose --project-name "$project" --project-directory "$working_dir" "${files[@]}" "$@"
}

# The working directory is Docker's label. Removal is the same bound as
# packages/core/src/paths.ts: absolute, no walk-up, not `/`, not a top-level
# directory. `realpath` is the last check so a symlink cannot leave /host.
remove_working_dir() {
  local dir="$1"
  [[ "$dir" == /* ]] || die "working directory is not absolute"
  [[ "$dir" != *..* ]] || die "refusing working directory that walks up"
  [[ "$dir" != "/" ]] || die "refusing to remove /"
  case "${dir#/}" in
    */*) ;;
    *) die "refusing to remove a top-level directory" ;;
  esac
  local target="${HOST_ROOT}${dir}"
  [ -d "$target" ] || die "working directory ${dir} does not exist on this host"
  local real
  real=$(realpath "$target")
  case "$real" in
    /host/*) ;;
    *) die "resolved path is outside /host" ;;
  esac
  [ "$real" != "/host" ] && [ "$real" != "/" ] || die "refusing to remove the host root"
  rm -rf -- "$real"
}

case "$verb" in
  up) compose up -d --remove-orphans ;;
  stop) compose stop ;;
  restart) compose stop && compose up -d --remove-orphans ;;
  build)
    if [ "$nocache" = "1" ]; then
      compose build --no-cache
    else
      compose build
    fi
    compose up -d --remove-orphans
    ;;
  down) compose down ;;
  down-volumes)
    compose down --volumes
    if [ "$directory" = "1" ]; then
      remove_working_dir "$working_dir"
    fi
    ;;
esac
