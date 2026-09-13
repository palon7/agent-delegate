export function parseObject(line) {
    try {
        const value = JSON.parse(line);
        if (value && typeof value === "object" && !Array.isArray(value))
            return value;
    }
    catch {
        /* caller records malformed output */
    }
    return undefined;
}
