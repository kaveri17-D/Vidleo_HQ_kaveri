/**
 * Operation-scoped Consent Manager for Browser-Side Media Acquisition
 * Tracks explicit user authorization strictly per-operation without collecting IP or sensitive metadata.
 */
import { ConsentState } from './types';

export class OperationConsentManager {
  private currentOperationId: string | null = null;
  private state: ConsentState = 'NOT_ASKED';
  private listeners: Set<(state: ConsentState) => void> = new Set();

  public startOperation(operationId: string): void {
    this.currentOperationId = operationId;
    this.state = 'CONSENT_DIALOG';
    this.notify();
  }

  public grantConsent(operationId: string): boolean {
    if (this.currentOperationId !== operationId) return false;
    this.state = 'GRANTED';
    this.notify();
    return true;
  }

  public declineConsent(operationId: string): boolean {
    if (this.currentOperationId !== operationId) return false;
    this.state = 'DECLINED';
    this.notify();
    return true;
  }

  public setAcquisitionActive(operationId: string): void {
    if (this.currentOperationId === operationId) {
      this.state = 'ACQUISITION_ACTIVE';
      this.notify();
    }
  }

  public markCompleted(operationId: string): void {
    if (this.currentOperationId === operationId) {
      this.state = 'COMPLETED';
      this.notify();
    }
  }

  public markFailed(operationId: string): void {
    if (this.currentOperationId === operationId) {
      this.state = 'FAILED';
      this.notify();
    }
  }

  public cancel(operationId?: string): void {
    if (!operationId || this.currentOperationId === operationId) {
      this.state = 'CANCELLED';
      this.notify();
    }
  }

  public reset(): void {
    this.currentOperationId = null;
    this.state = 'NOT_ASKED';
    this.notify();
  }

  public getState(): ConsentState {
    return this.state;
  }

  public isGranted(operationId: string): boolean {
    return this.currentOperationId === operationId && this.state === 'GRANTED';
  }

  public subscribe(listener: (state: ConsentState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.state);
      } catch (err) {
        console.error('[OperationConsentManager] Error in listener:', err);
      }
    });
  }
}

export const activeConsentManager = new OperationConsentManager();
