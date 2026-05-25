export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
    // Generate 32 bytes of random data for the verifier
    const array = new Uint8Array(32);
    window.crypto.getRandomValues(array);

    // Create base64url string
    const verifier = btoa(Array.from(array, byte => String.fromCharCode(byte)).join(''))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    // Hash the verifier using SHA-256
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await window.crypto.subtle.digest('SHA-256', data);

    // Create base64url string of the hash
    const challenge = btoa(Array.from(new Uint8Array(hash), byte => String.fromCharCode(byte)).join(''))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    return { verifier, challenge };
}
