import { describe, expect, it } from 'vitest'
import { taskflowLocation, taskflowPaths } from '@/modules/taskflow/lib/navigation'
import { findTaskflowProject } from '@/modules/taskflow/lib/project-match'

describe('the Taskflow Project of a Portta Project', () => {
  const registry = [
    { prefix: 'shop', path: '/home/ana/code/shop/' },
    { prefix: 'blog', path: '/home/ana/code/blog' },
  ]

  it('is the one whose directory is one of the Project directories, whatever the trailing slash', () => {
    expect(findTaskflowProject(registry, ['/home/ana/code/shop'])?.prefix).toBe('shop')
    expect(findTaskflowProject(registry, ['/srv/other', '/home/ana/code/blog/'])?.prefix).toBe('blog')
  })

  it('is none when no directory is shared, rather than a directory that merely starts the same', () => {
    expect(findTaskflowProject(registry, ['/home/ana/code'])).toBeNull()
    expect(findTaskflowProject(registry, ['/home/ana/code/shop-api'])).toBeNull()
    expect(findTaskflowProject(registry, [])).toBeNull()
  })
})

describe('Taskflow locations', () => {
  it('build hrefs under the Project and read them back, a worktree with a slash included', () => {
    const paths = taskflowPaths('shop')
    expect(paths.worktree('feature/login')).toBe('/projects/shop/worktrees/feature%2Flogin')
    expect(taskflowLocation(paths.worktree('feature/login'), 'shop')).toEqual({
      section: 'worktrees',
      id: 'feature/login',
    })
    expect(taskflowLocation(paths.runs(), 'shop')).toEqual({ section: 'runs', id: null })
    expect(taskflowLocation(paths.settings(), 'shop')).toEqual({ section: 'settings', id: null })
    expect(taskflowLocation('/projects/shop/tasks', 'shop')).toEqual({ section: null, id: null })
    expect(taskflowLocation('/projects/blog/runs/1', 'shop')).toEqual({ section: null, id: null })
  })
})
