import type { Dialer, PlaceCallRequest } from './dialer.js';

/**
 * Mock dialer for testing and development.
 * Simulates call placement without making real calls.
 */
export class MockDialer implements Dialer {
  readonly name = 'calle' as const;
  private callCount = 0;

  async placeCall(req: PlaceCallRequest): Promise<{ providerCallId: string }> {
    this.callCount++;
    const mockCallId = `mock-call-${Date.now()}-${this.callCount}`;
    console.log(`[MockDialer] Call ${this.callCount}: ${req.toE164} (${mockCallId})`);
    console.log(`  Script opener: ${req.script.opener}`);
    return { providerCallId: mockCallId };
  }

  async cancel(providerCallId: string): Promise<void> {
    console.log(`[MockDialer] Cancelling call: ${providerCallId}`);
  }
}
