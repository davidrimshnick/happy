export function trimIdent(text: string): string {
    // Split the text into an array of lines
    const lines = text.split('\n');

    // Remove leading and trailing empty lines
    while (lines.length > 0 && lines[0].trim() === '') {
        lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
    }

    // If no lines remain, return empty string
    if (lines.length === 0) {
        return '';
    }

    // Normalize tabs to spaces before calculating indentation.
    // Mixing tabs and spaces causes incorrect minSpaces calculation
    // because a tab is 1 character but represents multiple columns.
    const normalizedLines = lines.map(line => line.replace(/\t/g, '    '));

    // Find the minimum number of leading spaces in non-empty lines
    const minSpaces = normalizedLines.reduce((min, line) => {
        if (line.trim() === '') {
            return min;
        }
        const leadingSpaces = line.match(/^ */)![0].length;
        return Math.min(min, leadingSpaces);
    }, Infinity);

    // If minSpaces is still Infinity (all lines were empty), treat as 0
    const effectiveMinSpaces = minSpaces === Infinity ? 0 : minSpaces;

    // Remove the common leading spaces from each line
    const trimmedLines = normalizedLines.map(line => line.slice(effectiveMinSpaces));

    // Join the trimmed lines back into a single string
    return trimmedLines.join('\n');
}