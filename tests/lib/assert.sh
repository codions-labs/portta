#!/usr/bin/env bash
# Minimal assertion helpers.
#
# Deliberately dependency-free: the gateway's promise is that a host needs only
# Docker, Git and a shell, and the test suite has to hold itself to that too.

PORTTA_T_TOTAL=0
PORTTA_T_FAILED=0
PORTTA_T_SKIPPED=0
PORTTA_T_CURRENT=""

_t_color() { [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && printf '\033[%sm%s\033[0m' "$1" "$2" || printf '%s' "$2"; }

describe() { printf '\n%s\n' "$(_t_color 1 "$1")"; }

it() {
  PORTTA_T_CURRENT="$1"
  PORTTA_T_TOTAL=$((PORTTA_T_TOTAL + 1))
}

_t_pass() { printf '  %s %s\n' "$(_t_color 32 'ok')" "$PORTTA_T_CURRENT"; }

_t_fail() {
  PORTTA_T_FAILED=$((PORTTA_T_FAILED + 1))
  printf '  %s %s\n' "$(_t_color 31 'FAIL')" "$PORTTA_T_CURRENT"
  printf '       %s\n' "$1"
}

skip() {
  PORTTA_T_SKIPPED=$((PORTTA_T_SKIPPED + 1))
  PORTTA_T_TOTAL=$((PORTTA_T_TOTAL - 1))
  printf '  %s %s\n' "$(_t_color 33 'skip')" "${PORTTA_T_CURRENT}${1:+: $1}"
}

assert_eq() { # assert_eq <expected> <actual>
  if [ "$1" = "$2" ]; then _t_pass; else _t_fail "expected '$1', got '$2'"; fi
}

assert_ne() {
  if [ "$1" != "$2" ]; then _t_pass; else _t_fail "expected something other than '$1'"; fi
}

assert_contains() { # assert_contains <haystack> <needle>
  case "$1" in
    *"$2"*) _t_pass ;;
    *) _t_fail "expected output to contain '$2'; got: $(printf '%s' "$1" | head -c 400)" ;;
  esac
}

assert_not_contains() {
  case "$1" in
    *"$2"*) _t_fail "expected output NOT to contain '$2'" ;;
    *) _t_pass ;;
  esac
}

assert_success() { # assert_success <command...>
  local out
  if out=$("$@" 2>&1); then _t_pass; else _t_fail "command failed (exit $?): $* -> $(printf '%s' "$out" | tail -3)"; fi
}

assert_failure() { # assert_failure <command...>
  local out
  if out=$("$@" 2>&1); then _t_fail "expected failure but the command succeeded: $*"; else _t_pass; fi
}

assert_exit() { # assert_exit <code> <command...>
  local expected="$1" out actual; shift
  out=$("$@" 2>&1); actual=$?
  if [ "$actual" -eq "$expected" ]; then _t_pass
  else _t_fail "expected exit $expected, got $actual: $* -> $(printf '%s' "$out" | tail -3)"; fi
}

t_summary() {
  printf '\n'
  if [ "$PORTTA_T_FAILED" -eq 0 ]; then
    printf '%s  %s passed, %s skipped\n' "$(_t_color 32 'PASS')" "$PORTTA_T_TOTAL" "$PORTTA_T_SKIPPED"
    return 0
  fi
  printf '%s  %s of %s failed, %s skipped\n' "$(_t_color 31 'FAIL')" "$PORTTA_T_FAILED" "$PORTTA_T_TOTAL" "$PORTTA_T_SKIPPED"
  return 1
}
