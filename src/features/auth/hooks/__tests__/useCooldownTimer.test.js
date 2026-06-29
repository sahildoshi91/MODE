import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useCooldownTimer } from '../useCooldownTimer'

function HookHost({ cooldownState }) {
  const msg = useCooldownTimer(cooldownState)
  return React.createElement('View', { testMessage: msg })
}

function getMessage(tree) {
  return tree.root.findByType('View').props.testMessage
}

describe('useCooldownTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('returns null when cooldownState is null', () => {
    let tree
    act(() => {
      tree = renderer.create(React.createElement(HookHost, { cooldownState: null }))
    })
    expect(getMessage(tree)).toBeNull()
  })

  it('shows initial count and ticks from 38 to 37 after one second', () => {
    const state = {
      message: 'For security purposes, you can only request this after 38 seconds.',
      retryAfterSeconds: 38,
    }
    let tree
    act(() => {
      tree = renderer.create(React.createElement(HookHost, { cooldownState: state }))
    })
    expect(getMessage(tree)).toContain('38 seconds')

    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(getMessage(tree)).toContain('37 seconds')
  })

  it('shows singular "1 second" when one second remains', () => {
    const state = {
      message: 'For security purposes, you can only request this after 38 seconds.',
      retryAfterSeconds: 38,
    }
    let tree
    act(() => {
      tree = renderer.create(React.createElement(HookHost, { cooldownState: state }))
    })

    act(() => {
      jest.advanceTimersByTime(37000)
    })
    expect(getMessage(tree)).toContain('1 second')
    expect(getMessage(tree)).not.toMatch(/1 seconds/)
  })

  it('shows "Please wait before trying again." when countdown reaches zero', () => {
    const state = {
      message: 'For security purposes, you can only request this after 5 seconds.',
      retryAfterSeconds: 5,
    }
    let tree
    act(() => {
      tree = renderer.create(React.createElement(HookHost, { cooldownState: state }))
    })

    act(() => {
      jest.advanceTimersByTime(5000)
    })
    expect(getMessage(tree)).toBe('Please wait before trying again.')
  })

  it('corrects remaining when a tick fires late (deadline-based)', () => {
    const state = {
      message: 'For security purposes, you can only request this after 10 seconds.',
      retryAfterSeconds: 10,
    }
    let tree
    act(() => {
      tree = renderer.create(React.createElement(HookHost, { cooldownState: state }))
    })

    // Advance by 9.5 seconds: Math.ceil(0.5) = 1, not 2
    act(() => {
      jest.advanceTimersByTime(9500)
    })
    expect(getMessage(tree)).toContain('1 second')
  })

  it('shows message unchanged when no seconds pattern found (static fallback), then expires', () => {
    const state = {
      message: 'Rate limited. Try again later.',
      retryAfterSeconds: 5,
    }
    let tree
    act(() => {
      tree = renderer.create(React.createElement(HookHost, { cooldownState: state }))
    })
    expect(getMessage(tree)).toBe('Rate limited. Try again later.')

    act(() => {
      jest.advanceTimersByTime(5000)
    })
    expect(getMessage(tree)).toBe('Please wait before trying again.')
  })

  it('clears old timer and starts fresh when cooldownState is replaced', () => {
    const state1 = {
      message: 'For security purposes, you can only request this after 20 seconds.',
      retryAfterSeconds: 20,
    }
    let tree
    act(() => {
      tree = renderer.create(React.createElement(HookHost, { cooldownState: state1 }))
    })
    expect(getMessage(tree)).toContain('20 seconds')

    const state2 = {
      message: 'For security purposes, you can only request this after 10 seconds.',
      retryAfterSeconds: 10,
    }
    act(() => {
      tree.update(React.createElement(HookHost, { cooldownState: state2 }))
    })
    expect(getMessage(tree)).toContain('10 seconds')

    act(() => {
      jest.advanceTimersByTime(10000)
    })
    expect(getMessage(tree)).toBe('Please wait before trying again.')
  })

  it('clears timer and returns null when cooldownState set to null', () => {
    const state = {
      message: 'For security purposes, you can only request this after 10 seconds.',
      retryAfterSeconds: 10,
    }
    let tree
    act(() => {
      tree = renderer.create(React.createElement(HookHost, { cooldownState: state }))
    })
    expect(getMessage(tree)).toContain('10 seconds')

    act(() => {
      tree.update(React.createElement(HookHost, { cooldownState: null }))
    })
    expect(getMessage(tree)).toBeNull()

    act(() => {
      jest.advanceTimersByTime(10000)
    })
    expect(getMessage(tree)).toBeNull()
  })
})
