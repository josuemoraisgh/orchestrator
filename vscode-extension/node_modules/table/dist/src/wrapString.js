"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wrapString = void 0;
const utils_1 = require("./utils");
/**
 * Creates an array of strings split into groups of at most size terminal columns.
 *
 * wrapText is different from would-be "chunk" implementation
 * in that whitespace characters that occur on a chunk size limit are trimmed.
 *
 */
const wrapString = (subject, size) => {
    let subjectSlice = subject;
    const chunks = [];
    do {
        const chunkLength = (0, utils_1.calculateSliceLength)((0, utils_1.stripAnsi)(subjectSlice), size);
        chunks.push((0, utils_1.sliceAnsi)(subjectSlice, 0, chunkLength));
        subjectSlice = (0, utils_1.sliceAnsi)(subjectSlice, chunkLength).trim();
    } while ((0, utils_1.stringWidth)(subjectSlice));
    return chunks;
};
exports.wrapString = wrapString;
//# sourceMappingURL=wrapString.js.map