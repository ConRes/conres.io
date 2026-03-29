// @ts-check
/**
 * Browser and OS detection for metadata and filename labeling.
 *
 * Produces a human-readable descriptor like "Chrome 145 (macOS)" from
 * the browser's navigator object.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

/**
 * @typedef {{
 *   browser: string,
 *   browserVersion: string,
 *   os: string,
 *   label: string,
 *   userAgent: string,
 * }} EnvironmentDescriptor
 */

/**
 * Detect browser brand, version, and OS from navigator.
 *
 * @returns {EnvironmentDescriptor}
 */
export function getEnvironmentDescriptor() {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

    const browser = detectBrowser(ua);
    const os = detectOS(ua);
    const label = `${browser.name} ${browser.version} (${os})`;

    return {
        browser: browser.name,
        browserVersion: browser.version,
        os,
        label,
        userAgent: ua,
    };
}

/**
 * @param {string} ua
 * @returns {{ name: string, version: string }}
 */
function detectBrowser(ua) {
    // Order matters — check more specific patterns first

    // Firefox (must be before generic Mozilla check)
    const firefox = ua.match(/Firefox\/(\d+)/);
    if (firefox) return { name: 'Firefox', version: firefox[1] };

    // Edge (Chromium-based, must be before Chrome)
    const edg = ua.match(/Edg\/(\d+)/);
    if (edg) return { name: 'Edge', version: edg[1] };

    // Chrome / HeadlessChrome (must be before Safari — Chrome UA includes Safari)
    const chrome = ua.match(/(?:Headless)?Chrome\/(\d+)/);
    if (chrome && !ua.includes('Edg/')) return { name: 'Chrome', version: chrome[1] };

    // Safari (only if no Chrome/Chromium signature)
    const safari = ua.match(/Version\/(\d+(?:\.\d+)?)[\s\S]*Safari/);
    if (safari) return { name: 'Safari', version: safari[1] };

    // Node.js
    const nodeMatch = ua.match(/^Node\.js\/(\d+)/);
    if (nodeMatch) return { name: 'Node.js', version: nodeMatch[1] };
    if (!ua && typeof process !== 'undefined' && process.versions?.node) {
        return { name: 'Node.js', version: process.versions.node.split('.')[0] };
    }

    // Log unrecognized UA for debugging
    if (ua) console.warn('[EnvironmentDescriptor] Unrecognized userAgent:', ua);

    return { name: 'Unknown', version: '0' };
}

/**
 * @param {string} ua
 * @returns {string}
 */
function detectOS(ua) {
    // macOS / Mac OS X
    if (ua.includes('Macintosh') || ua.includes('Mac OS X')) return 'macOS';

    // Windows
    if (ua.includes('Windows')) return 'Windows';

    // Linux distros (check specific distros before generic Linux)
    if (ua.includes('Ubuntu')) return 'Ubuntu';
    if (ua.includes('Fedora')) return 'Fedora';
    if (ua.includes('Debian')) return 'Debian';
    if (ua.includes('Arch')) return 'Arch';
    if (ua.includes('CentOS')) return 'CentOS';
    if (ua.includes('Red Hat')) return 'Red Hat';
    if (ua.includes('SUSE')) return 'SUSE';
    if (ua.includes('Gentoo')) return 'Gentoo';
    if (ua.includes('Linux')) return 'Linux';

    // ChromeOS
    if (ua.includes('CrOS')) return 'ChromeOS';

    // iOS / iPadOS
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';

    // Android
    if (ua.includes('Android')) return 'Android';

    // Node.js
    if (ua.startsWith('Node.js') || (!ua && typeof process !== 'undefined')) {
        const platform = typeof process !== 'undefined' ? process.platform : '';
        if (platform === 'darwin') return 'macOS';
        if (platform === 'win32') return 'Windows';
        if (platform === 'linux') return 'Linux';
        if (platform) return platform;
    }

    return 'Unknown';
}
