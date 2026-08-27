"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
vitest_1.vi.mock('../db', () => ({
    query: vitest_1.vi.fn(),
    default: {},
}));
const db_1 = require("../db");
const auth_1 = require("./auth");
function responseStub() {
    const response = {};
    response.status = vitest_1.vi.fn(() => response);
    response.json = vitest_1.vi.fn(() => response);
    return response;
}
(0, vitest_1.describe)('requireModuleAccess', () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.clearAllMocks());
    (0, vitest_1.it)('blocks direct API access when the role hides the module', async () => {
        vitest_1.vi.mocked(db_1.query).mockResolvedValueOnce({ rows: [{ access_level: 'hidden' }] });
        const response = responseStub();
        const next = vitest_1.vi.fn();
        await (0, auth_1.requireModuleAccess)('design_books')({ user: { id: 'user-1' } }, response, next);
        (0, vitest_1.expect)(response.status).toHaveBeenCalledWith(403);
        (0, vitest_1.expect)(response.json).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            error: vitest_1.expect.objectContaining({ code: 'MODULE_HIDDEN' }),
        }));
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('preserves visible access for existing roles without a configured row', async () => {
        vitest_1.vi.mocked(db_1.query).mockResolvedValueOnce({ rows: [] });
        const response = responseStub();
        const next = vitest_1.vi.fn();
        await (0, auth_1.requireModuleAccess)('pim')({ user: { id: 'user-1' } }, response, next);
        (0, vitest_1.expect)(next).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(response.status).not.toHaveBeenCalled();
    });
});
