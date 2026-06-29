import { useEffect, useRef, useState } from 'react'

const SECONDS_PATTERN = /\d+\s+second\(?s?\)?/

function replaceSeconds(message, remaining) {
  const unit = remaining === 1 ? 'second' : 'seconds'
  return message.replace(SECONDS_PATTERN, `${remaining} ${unit}`)
}

// Timing is deadline-based so background/foreground resumes stay correct.
export function useCooldownTimer(cooldownState) {
  const deadlineRef = useRef(null)
  const [displayMessage, setDisplayMessage] = useState(null)

  useEffect(() => {
    if (!cooldownState) {
      deadlineRef.current = null
      setDisplayMessage(null)
      return undefined
    }

    const { message, retryAfterSeconds } = cooldownState
    const deadline = Date.now() + retryAfterSeconds * 1000
    deadlineRef.current = deadline

    function tick() {
      const remaining = Math.ceil((deadlineRef.current - Date.now()) / 1000)
      if (remaining <= 0) {
        setDisplayMessage('Please wait before trying again.')
        return false
      }
      setDisplayMessage(replaceSeconds(message, remaining))
      return true
    }

    if (!tick()) {
      return undefined
    }

    const id = setInterval(() => {
      if (!tick()) {
        clearInterval(id)
      }
    }, 1000)

    return () => clearInterval(id)
  }, [cooldownState])

  return displayMessage
}
