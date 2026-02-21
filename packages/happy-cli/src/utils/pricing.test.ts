import { describe, it, expect } from 'vitest'
import { PRICING } from './pricing'

describe('pricing', () => {
    it('claude-opus-4-6 pricing exists and has correct values', () => {
        const pricing = PRICING['claude-opus-4-6']
        expect(pricing).toBeDefined()
        expect(pricing.input).toBe(15.0)
        expect(pricing.output).toBe(75.0)
        expect(pricing.cache_write).toBe(18.75)
        expect(pricing.cache_read).toBe(1.50)
    })

    it('claude-sonnet-4-6 pricing exists and has correct values', () => {
        const pricing = PRICING['claude-sonnet-4-6']
        expect(pricing).toBeDefined()
        expect(pricing.input).toBe(3.0)
        expect(pricing.output).toBe(15.0)
        expect(pricing.cache_write).toBe(3.75)
        expect(pricing.cache_read).toBe(0.30)
    })
})
