"use strict";
// @vitest-environment node
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = __importDefault(require("node:http"));
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const vitest_1 = require("vitest");
const testSecret = 'projects-audit-summary-test-secret';
const actorId = 'actor-1';
const state = vitest_1.vi.hoisted(() => ({
    auditRows: [],
}));
function resultFor(sql, params = []) {
    if (sql.startsWith('select rma.access_level'))
        return { rows: [] };
    if (sql.startsWith('select * from systems where id=$1')) {
        return {
            rows: [{
                    id: 'system-1',
                    system_code: 'SYS-01',
                    system_name: 'Test System',
                    system_type: 'Filtration',
                    status: 'Draft',
                    water_type: 'Fresh Water',
                    calculation_inputs: {},
                    loop1_name: 'Loop 1',
                    loop2_name: 'Loop 2',
                    loop3_name: 'Loop 3',
                }],
        };
    }
    if (sql.startsWith('select id, status from systems where id=$1')) {
        return { rows: [{ id: 'system-1', status: 'Draft' }] };
    }
    if (sql.startsWith('select e.exhibit_code'))
        return { rows: [] };
    if (sql.startsWith('select sel.exhibit_id'))
        return { rows: [] };
    if (sql.startsWith('select * from system_flow_side_streams'))
        return { rows: [] };
    if (sql.startsWith('select * from system_flow_fractionator_allocations'))
        return { rows: [] };
    if (sql.startsWith('delete from system_flow_side_streams')) {
        return { rows: [{ id: 'stream-1', name: 'UV', parent_loop_number: 1, flow_pct: 20 }] };
    }
    if (sql.startsWith('insert into project_equipment_items')) {
        return {
            rows: [{
                    id: 'equipment-item-1',
                    equip_code: 'EQ-01',
                    system_id: 'system-1',
                    description: 'Test equipment',
                }],
        };
    }
    if (sql.startsWith('update project_equipment_items')) {
        return {
            rows: [{
                    id: 'equipment-item-1',
                    equip_code: 'EQ-01',
                    system_id: 'system-1',
                    description: 'Updated equipment',
                }],
        };
    }
    if (sql.startsWith('select * from project_equipment_items')) {
        return {
            rows: [{
                    id: 'equipment-item-1',
                    equip_code: 'EQ-01',
                    system_id: 'system-1',
                    description: 'Test equipment',
                }],
        };
    }
    if (sql.startsWith('select system_id from project_equipment_items')) {
        return { rows: [{ system_id: 'system-1' }] };
    }
    if (sql.startsWith('delete from project_equipment_items'))
        return { rows: [{ id: 'equipment-item-1' }] };
    if (sql.startsWith('insert into equipment_instances')) {
        return {
            rows: [{
                    id: 'equipment-1',
                    equipment_code: 'LEG-01',
                    equipment_name: 'Legacy Equipment',
                    equipment_type: 'Pump',
                }],
        };
    }
    if (sql.startsWith('update equipment_instances')) {
        return {
            rows: [{
                    id: 'equipment-1',
                    equipment_code: 'LEG-01',
                    equipment_name: 'Updated Legacy Equipment',
                    equipment_type: 'Pump',
                    status: 'Active',
                }],
        };
    }
    if (sql.startsWith('select status from systems'))
        return { rows: [{ status: 'Draft' }] };
    if (sql.startsWith('select system_id from equipment_instances'))
        return { rows: [{ system_id: null }] };
    if (sql.startsWith('insert into audit_logs')) {
        state.auditRows.push({
            entityType: String(params[0]),
            entityId: String(params[1]),
            action: String(params[2]),
            details: params[4] ?? null,
        });
    }
    return { rows: [] };
}
vitest_1.vi.mock('../db', () => {
    const query = vitest_1.vi.fn(async (text, params = []) => {
        const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
        return resultFor(sql, params);
    });
    const clientQuery = vitest_1.vi.fn(async (text, params = []) => {
        const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
        if (sql.startsWith('insert into systems')) {
            return {
                rows: [{
                        id: 'system-1',
                        system_code: 'SYS-01',
                        system_name: 'Test System',
                        system_type: 'Filtration',
                        status: 'Draft',
                    }],
            };
        }
        if (sql.startsWith('update systems set')) {
            return {
                rows: [{
                        id: 'system-1',
                        system_code: 'SYS-01',
                        system_name: 'Updated System',
                        system_type: 'Filtration',
                        status: 'Active',
                    }],
            };
        }
        if (sql.startsWith('select id from systems'))
            return { rows: [{ id: 'system-1' }] };
        if (sql.startsWith('select * from systems where id=$1 for update')) {
            return { rows: [{ id: 'system-1', status: 'Draft' }] };
        }
        if (sql.startsWith('select * from system_flow_side_streams where id=$1')) {
            return { rows: [{ id: 'stream-1', name: 'UV', parent_loop_number: 1, flow_pct: 20 }] };
        }
        if (sql.startsWith('insert into system_flow_side_streams')) {
            return {
                rows: [{
                        id: 'stream-1',
                        name: 'UV',
                        parent_loop_number: 1,
                        flow_pct: 20,
                    }],
            };
        }
        if (sql.startsWith('update system_flow_side_streams')) {
            return {
                rows: [{
                        id: 'stream-1',
                        name: 'Updated UV',
                        parent_loop_number: 1,
                        flow_pct: 25,
                    }],
            };
        }
        return { rows: [] };
    });
    const pool = {
        connect: vitest_1.vi.fn(async () => ({
            query: clientQuery,
            release: vitest_1.vi.fn(),
        })),
    };
    return { query, default: pool };
});
function request(app, method, path, token, body = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close();
                reject(new Error('Could not determine test server port'));
                return;
            }
            const payload = JSON.stringify(body);
            const req = node_http_1.default.request({
                host: '127.0.0.1',
                port: address.port,
                path,
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
            }, res => {
                let response = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { response += chunk; });
                res.on('end', () => {
                    server.close(error => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        try {
                            resolve({ status: res.statusCode ?? 0, body: response ? JSON.parse(response) : {} });
                        }
                        catch (error) {
                            reject(error);
                        }
                    });
                });
            });
            req.on('error', error => {
                server.close();
                reject(error);
            });
            req.write(payload);
            req.end();
        });
    });
}
(0, vitest_1.describe)('persisted audit summaries for project mutations', () => {
    let app;
    let token;
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = testSecret;
        const { default: projectRoutes } = await Promise.resolve().then(() => __importStar(require('./projects')));
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        app.use('/api/v1', projectRoutes);
        token = jsonwebtoken_1.default.sign({ id: actorId, email: 'actor@example.com', role: 'admin' }, testSecret);
    });
    (0, vitest_1.beforeEach)(() => {
        state.auditRows.length = 0;
    });
    (0, vitest_1.afterAll)(() => {
        delete process.env.JWT_SECRET;
    });
    const expectSummary = (entityType, entityId, action, summary) => {
        (0, vitest_1.expect)(state.auditRows).toContainEqual(vitest_1.expect.objectContaining({
            entityType,
            entityId,
            action,
            details: vitest_1.expect.objectContaining({ summary }),
        }));
    };
    (0, vitest_1.it)('persists summaries when systems are created and updated', async () => {
        (0, vitest_1.expect)((await request(app, 'POST', '/api/v1/systems', token, {
            system_code: 'SYS-01',
            project_id: 'project-1',
            system_name: 'Test System',
            system_type: 'Filtration',
            water_type: 'Fresh Water',
        })).status).toBe(201);
        expectSummary('system', 'system-1', 'CREATE', 'System SYS-01 created');
        (0, vitest_1.expect)((await request(app, 'PUT', '/api/v1/systems/system-1', token, {
            system_name: 'Updated System',
            system_type: 'Filtration',
            status: 'Active',
            water_type: 'Fresh Water',
        })).status).toBe(200);
        expectSummary('system', 'system-1', 'UPDATE', 'System details updated');
    });
    (0, vitest_1.it)('persists readable summaries for side-stream add, update, and removal', async () => {
        (0, vitest_1.expect)((await request(app, 'POST', '/api/v1/systems/system-1/side-streams', token, {
            parent_loop_number: 1,
            name: 'UV',
            flow_pct: 20,
        })).status).toBe(201);
        expectSummary('system', 'system-1', 'ADD_SIDE_STREAM', 'UV side stream added to Loop 1');
        (0, vitest_1.expect)((await request(app, 'PUT', '/api/v1/systems/system-1/side-streams/stream-1', token, {
            parent_loop_number: 1,
            name: 'Updated UV',
            flow_pct: 25,
        })).status).toBe(200);
        expectSummary('system', 'system-1', 'UPDATE_SIDE_STREAM', 'Updated UV side stream updated');
        (0, vitest_1.expect)((await request(app, 'DELETE', '/api/v1/systems/system-1/side-streams/stream-1', token)).status).toBe(200);
        expectSummary('system', 'system-1', 'DELETE_SIDE_STREAM', 'UV side stream removed');
    });
    (0, vitest_1.it)('persists readable summaries for equipment added to, updated in, and removed from systems', async () => {
        (0, vitest_1.expect)((await request(app, 'POST', '/api/v1/equipment-items', token, {
            equip_code: 'eq-01',
            project_id: 'project-1',
            system_id: 'system-1',
            description: 'Test equipment',
        })).status).toBe(201);
        expectSummary('system', 'system-1', 'ADD_EQUIPMENT', 'Equipment EQ-01 added to system');
        (0, vitest_1.expect)((await request(app, 'PUT', '/api/v1/equipment-items/equipment-item-1', token, {
            equip_code: 'eq-01',
            system_id: 'system-1',
            description: 'Updated equipment',
        })).status).toBe(200);
        expectSummary('system', 'system-1', 'UPDATE_EQUIPMENT', 'Equipment EQ-01 updated');
        (0, vitest_1.expect)((await request(app, 'DELETE', '/api/v1/equipment-items/equipment-item-1', token)).status).toBe(200);
        expectSummary('system', 'system-1', 'REMOVE_EQUIPMENT', 'Equipment EQ-01 removed from system');
    });
    (0, vitest_1.it)('persists summaries for legacy equipment create and update', async () => {
        (0, vitest_1.expect)((await request(app, 'POST', '/api/v1/equipment-instances', token, {
            equipment_code: 'LEG-01',
            project_id: 'project-1',
            equipment_type: 'Pump',
            equipment_name: 'Legacy Equipment',
        })).status).toBe(201);
        expectSummary('equipment', 'equipment-1', 'CREATE', 'Equipment LEG-01 created');
        (0, vitest_1.expect)((await request(app, 'PUT', '/api/v1/equipment-instances/equipment-1', token, {
            equipment_type: 'Pump',
            equipment_name: 'Updated Legacy Equipment',
            status: 'Active',
        })).status).toBe(200);
        expectSummary('equipment', 'equipment-1', 'UPDATE', 'Equipment details updated');
    });
    (0, vitest_1.it)('persists the before-and-after status transition summary', async () => {
        const response = await request(app, 'POST', '/api/v1/lifecycle/transition', token, {
            entity_type: 'system',
            entity_id: 'system-1',
            to_state: 'Approved',
            comment: 'Ready for review',
        });
        (0, vitest_1.expect)(response.status).toBe(200);
        expectSummary('system', 'system-1', 'STATE_TRANSITION', 'Status changed from Draft → Approved');
    });
});
