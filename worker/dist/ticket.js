/**
 * NEXUS Worker Ticket Verification Engine (Web Crypto / WinterCG compatible)
 */
export class TicketValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TicketValidationError';
    }
}
function base64UrlDecode(str) {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
        base64 += '=';
    }
    // Decode UTF-8 string from base64
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}
function hexToBytes(hex) {
    if (hex.length % 2 !== 0) {
        throw new TicketValidationError('Invalid hex string length');
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        const val = parseInt(hex.substring(i, i + 2), 16);
        if (isNaN(val))
            throw new TicketValidationError('Invalid hex character');
        bytes[i / 2] = val;
    }
    return bytes;
}
export async function computeSha256Hex(data) {
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
export async function verifyWorkerTicket(ticket, secret, targetUrl, expectedResourceType) {
    if (!ticket || typeof ticket !== 'string') {
        throw new TicketValidationError('Missing ticket');
    }
    const parts = ticket.split('.');
    if (parts.length !== 2) {
        throw new TicketValidationError('Malformed ticket structure');
    }
    const [b64Payload, signatureHex] = parts;
    const encoder = new TextEncoder();
    // Import HMAC key
    let key;
    try {
        key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    }
    catch (err) {
        throw new TicketValidationError(`Failed to import secret: ${err.message}`);
    }
    // Verify HMAC signature
    let isValid = false;
    try {
        const sigBytes = hexToBytes(signatureHex);
        isValid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(b64Payload));
    }
    catch {
        isValid = false;
    }
    if (!isValid) {
        throw new TicketValidationError('Ticket cryptographic signature failed');
    }
    // Parse payload
    let payload;
    try {
        const jsonStr = base64UrlDecode(b64Payload);
        payload = JSON.parse(jsonStr);
    }
    catch (err) {
        throw new TicketValidationError(`Corrupt ticket payload: ${err.message}`);
    }
    // Expiry check
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < nowSec) {
        throw new TicketValidationError('Ticket has expired');
    }
    // If ticket is bound to a specific URL hash (u_hash), verify it
    if (payload.u_hash && targetUrl) {
        const targetHash = await computeSha256Hex(targetUrl);
        if (payload.u_hash !== targetHash) {
            throw new TicketValidationError('Target URL does not match ticket binding (u_hash mismatch)');
        }
    }
    // If resource type is specified or expected, verify resource type binding
    if (expectedResourceType) {
        const ticketTyp = payload.typ || 'range';
        if (ticketTyp !== expectedResourceType) {
            throw new TicketValidationError(`Resource type mismatch: ticket is authorized for '${ticketTyp}', requested '${expectedResourceType}'`);
        }
    }
    return payload;
}
