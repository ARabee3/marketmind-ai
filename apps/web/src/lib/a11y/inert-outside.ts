type InertState = {
  readonly element: HTMLElement
  readonly inert: boolean
}

/**
 * Makes every DOM branch outside a modal container inert while preserving the
 * container's own backdrop and controls. Returns a cleanup that restores each
 * element's previous state.
 */
export function inertOutside(container: HTMLElement | null): () => void {
  if (!container) return () => undefined

  const states: InertState[] = []
  let branch: HTMLElement | null = container

  while (branch && branch !== document.body) {
    const parent: HTMLElement | null = branch.parentElement
    if (!parent) break

    for (const sibling of parent.children) {
      if (!(sibling instanceof HTMLElement) || sibling === branch) continue
      states.push({ element: sibling, inert: sibling.inert === true })
      sibling.inert = true
    }

    branch = parent
  }

  return () => {
    for (const state of states.reverse()) {
      state.element.inert = state.inert
    }
  }
}
