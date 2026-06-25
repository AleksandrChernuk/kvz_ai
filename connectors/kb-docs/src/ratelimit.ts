// Simple token-bucket rate limiter (connector-standard: rate limits).

export class TokenBucket {
  private tokens: number
  private last: number

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    now: number = Date.now()
  ) {
    this.tokens = capacity
    this.last = now
  }

  // Returns true if a token was consumed, false if rate-limited.
  take(now: number = Date.now()): boolean {
    const elapsed = (now - this.last) / 1000
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec)
    this.last = now
    if (this.tokens >= 1) {
      this.tokens -= 1
      return true
    }
    return false
  }
}
