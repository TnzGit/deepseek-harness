// @vitest-environment jsdom
/**
 * Field-control behavior: what a control renders for a staged draft, how an
 * overridden field offers its reset, and that a control never writes on its own.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SecretField, SelectField, ValueField } from '../src/client/fields.tsx'

afterEach(cleanup)

const frame = {
  id: 'field',
  label: 'Command timeout',
  hint: 'How long one command may run.',
  overriddenLabel: 'Overridden',
  resetLabel: 'Reset to default',
  invalidLabel: 'Enter a number.',
  disabled: false,
  overridden: false,
  invalid: false,
}

describe('ValueField', () => {
  it('stages every keystroke without writing', () => {
    const onEdit = vi.fn()
    render(<ValueField {...frame} text="60000" onEdit={onEdit} onReset={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Command timeout'), { target: { value: '9000' } })

    expect(onEdit).toHaveBeenCalledWith('9000')
  })

  it('renders the staged text it is given rather than a draft of its own', () => {
    const { rerender } = render(<ValueField {...frame} text="60000" onEdit={vi.fn()} onReset={vi.fn()} />)
    expect(screen.getByLabelText('Command timeout')).toHaveProperty('value', '60000')

    rerender(<ValueField {...frame} text="9000" onEdit={vi.fn()} onReset={vi.fn()} />)

    expect(screen.getByLabelText('Command timeout')).toHaveProperty('value', '9000')
  })

  it('offers the reset only while an override would stand', () => {
    const onReset = vi.fn()
    const { rerender } = render(<ValueField {...frame} text="9000" onEdit={vi.fn()} onReset={onReset} />)
    expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull()

    rerender(<ValueField {...frame} overridden text="9000" onEdit={vi.fn()} onReset={onReset} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))

    expect(screen.getByText('Overridden')).toBeTruthy()
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('replaces the hint with the reason an invalid draft cannot be saved', () => {
    render(<ValueField {...frame} invalid text="soon" onEdit={vi.fn()} onReset={vi.fn()} />)

    expect(screen.getByText('Enter a number.')).toBeTruthy()
    expect(screen.queryByText('How long one command may run.')).toBeNull()
    expect(screen.getByLabelText('Command timeout').getAttribute('aria-invalid')).toBe('true')
  })

  it('hints a numeric keypad and renders a placeholder when asked', () => {
    render(
      <ValueField
        {...frame}
        numeric
        placeholder="https://api.deepseek.com"
        text=""
        onEdit={vi.fn()}
        onReset={vi.fn()}
      />,
    )
    const input = screen.getByLabelText('Command timeout')

    expect(input.getAttribute('inputmode')).toBe('numeric')
    expect(input).toHaveProperty('placeholder', 'https://api.deepseek.com')
  })

  it('disables the control and its reset while the document is read-only', () => {
    render(<ValueField {...frame} disabled overridden text="9000" onEdit={vi.fn()} onReset={vi.fn()} />)

    expect(screen.getByLabelText('Command timeout')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Reset to default' })).toHaveProperty('disabled', true)
  })
})

describe('SecretField', () => {
  const secret = {
    id: 'key',
    label: 'API key',
    hint: 'Stored outside the settings file.',
    disabled: false,
  }

  it('stages the draft and never renders it', () => {
    const onEdit = vi.fn()
    render(
      <SecretField
        {...secret}
        text=""
        configured={false}
        stateLabel="No key is configured."
        onEdit={onEdit}
      />,
    )
    const input = screen.getByLabelText('API key')

    fireEvent.change(input, { target: { value: 'ds-secret' } })

    expect(onEdit).toHaveBeenCalledWith('ds-secret')
    expect(input).toHaveProperty('type', 'password')
  })

  it('reports the configured state the Host holds', () => {
    const { rerender } = render(
      <SecretField
        {...secret}
        text=""
        configured={false}
        stateLabel="No key is configured."
        onEdit={vi.fn()}
      />,
    )
    expect(screen.getByText('No key is configured.')).toBeTruthy()

    rerender(
      <SecretField
        {...secret}
        text="ds-secret"
        configured
        stateLabel="A key is configured."
        onEdit={vi.fn()}
      />,
    )

    expect(screen.getByText('A key is configured.')).toBeTruthy()
    expect(screen.getByLabelText('API key')).toHaveProperty('value', 'ds-secret')
  })

  it('disables the control when it is told to', () => {
    render(
      <SecretField
        {...secret}
        disabled
        text=""
        configured
        stateLabel="A key is configured."
        onEdit={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('API key')).toHaveProperty('disabled', true)
  })
})

describe('SelectField', () => {
  const select = {
    id: 'trigger',
    label: 'Trigger',
    hint: 'When a notification fires.',
    overriddenLabel: 'Overridden',
    resetLabel: 'Reset to default',
    invalidLabel: 'Choose a listed option.',
    disabled: false,
    overridden: false,
    invalid: false,
  }
  const options = [
    { value: 'turn-end', label: '每轮回复结束' },
    { value: 'goal-complete', label: '仅目标完成时' },
  ]

  it('stages the chosen option without writing', () => {
    const onEdit = vi.fn()
    render(<SelectField {...select} options={options} text="turn-end" onEdit={onEdit} onReset={vi.fn()} />)

    expect(screen.getByLabelText('Trigger')).toHaveProperty('value', 'turn-end')
    fireEvent.change(screen.getByLabelText('Trigger'), { target: { value: 'goal-complete' } })

    expect(onEdit).toHaveBeenCalledWith('goal-complete')
  })

  it('renders the option labels it is given', () => {
    render(<SelectField {...select} options={options} text="turn-end" onEdit={vi.fn()} onReset={vi.fn()} />)

    expect(screen.getByRole('option', { name: '每轮回复结束' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '仅目标完成时' })).toBeTruthy()
  })

  it('offers the reset only while an override would stand', () => {
    const onReset = vi.fn()
    const { rerender } = render(
      <SelectField {...select} options={options} text="turn-end" onEdit={vi.fn()} onReset={onReset} />,
    )
    expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull()

    rerender(<SelectField {...select} options={options} overridden text="both" onEdit={vi.fn()} onReset={onReset} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))

    expect(screen.getByText('Overridden')).toBeTruthy()
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('replaces the hint while invalid and disables with the document', () => {
    render(
      <SelectField
        {...select}
        options={options}
        invalid
        disabled
        text=""
        onEdit={vi.fn()}
        onReset={vi.fn()}
      />,
    )

    expect(screen.getByText('Choose a listed option.')).toBeTruthy()
    expect(screen.queryByText('When a notification fires.')).toBeNull()
    expect(screen.getByLabelText('Trigger')).toHaveProperty('disabled', true)
  })
})
