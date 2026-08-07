import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { RevisionRequestDialog } from '../RevisionRequestDialog'

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

function closeButton() {
  // The header X button is the first "cancel" control in the dialog.
  return screen.getAllByRole('button', {
    name: 'ContentReview.revisionDialog.cancel',
  })[0]
}

function Harness({ onSubmit = () => {} }: { onSubmit?: (notes: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <RevisionRequestDialog
        isOpen={open}
        versionNumber={2}
        isSubmitting={false}
        onClose={() => setOpen(false)}
        onSubmit={onSubmit}
      />
    </div>
  )
}

describe('RevisionRequestDialog', () => {
  it('opens, moves focus inside, and restores focus to the trigger on Escape', () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open dialog' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeDefined()
    // Initial focus lands on the header close button inside the dialog.
    expect(document.activeElement).toBe(closeButton())

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    // Focus returns to the element that opened the dialog.
    expect(document.activeElement).toBe(trigger)
  })

  it('wraps Tab from the last control back to the first control', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }))

    const submit = screen.getByRole('button', { name: 'ContentReview.revisionDialog.submit' })
    submit.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false })

    // The header close button is the first focusable control in the dialog.
    expect(document.activeElement).toBe(closeButton())
  })

  it('wraps Shift+Tab from the first control back to the last control', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }))

    closeButton().focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'ContentReview.revisionDialog.submit' }),
    )
  })

  it('returns focus to the first control when Tab happens outside the dialog', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }))

    // Simulate focus lost to the background (e.g. assistive tech or stray Tab).
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false })

    // Focus must never leave the dialog: it lands on the first control.
    expect(document.activeElement).toBe(closeButton())
  })

  it('submits trimmed notes when provided', () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }))

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '  Add the phone number.  ' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'ContentReview.revisionDialog.submit' }),
    )

    expect(onSubmit).toHaveBeenCalledWith('Add the phone number.')
  })
})
