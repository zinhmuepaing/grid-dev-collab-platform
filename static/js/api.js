/**
 * Grid — Centralized API Fetch Wrapper
 * Provides get, post, put, del methods with automatic JSON handling,
 * auth redirect on 401, and structured error throwing.
 */

const DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
};

/**
 * Core fetch wrapper. All public methods delegate here.
 * @param {string} url - Relative URL path (e.g., "/api/users/me")
 * @param {object} options - Fetch options override
 * @returns {Promise<any>} Parsed JSON response
 */
async function request(url, options = {}) {
    const config = {
        headers: { ...DEFAULT_HEADERS },
        ...options,
    };

    // Don't send Content-Type for requests without a body (GET, DELETE)
    if (!config.body) {
        delete config.headers['Content-Type'];
    }

    const response = await fetch(url, config);

    // Redirect to login on authentication failure
    if (response.status === 401) {
        window.location.href = '/auth/github/login';
        // Throw so callers (and Promise.allSettled) see a settled promise
        // instead of hanging forever on a never-resolving one.
        throw new Error('Not authenticated');
    }

    // Parse JSON body (may be error details)
    let data;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        const message = (data && (data.error || data.message)) || response.statusText;
        const error = new Error(message);
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

/**
 * Send a GET request.
 * @param {string} url - Relative URL path
 * @returns {Promise<any>}
 */
async function get(url) {
    return request(url, { method: 'GET' });
}

/**
 * Send a POST request with a JSON body.
 * @param {string} url - Relative URL path
 * @param {any} [body] - Request payload (will be JSON-stringified)
 * @returns {Promise<any>}
 */
async function post(url, body) {
    const options = { method: 'POST' };
    if (body !== undefined) {
        options.body = JSON.stringify(body);
    }
    return request(url, options);
}

/**
 * Send a PUT request with a JSON body.
 * @param {string} url - Relative URL path
 * @param {any} [body] - Request payload (will be JSON-stringified)
 * @returns {Promise<any>}
 */
async function put(url, body) {
    const options = { method: 'PUT' };
    if (body !== undefined) {
        options.body = JSON.stringify(body);
    }
    return request(url, options);
}

/**
 * Send a DELETE request.
 * @param {string} url - Relative URL path
 * @param {any} [body] - Optional request payload
 * @returns {Promise<any>}
 */
async function del(url, body) {
    const options = { method: 'DELETE' };
    if (body !== undefined) {
        options.body = JSON.stringify(body);
    }
    return request(url, options);
}

const api = { get, post, put, delete: del };

export { get, post, put, del };
export default api;
