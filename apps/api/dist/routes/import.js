"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMPONENT_IMPORT_FIELDS = exports.CSV_IMPORT_MAX_FILE_SIZE = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const multer_1 = __importDefault(require("multer"));
const csv_parser_1 = __importDefault(require("csv-parser"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const router = (0, express_1.Router)();
const csvUploadDestination = path_1.default.join(__dirname, '../../uploads/tmp/');
/** Keep all disk-backed PIM CSV imports bounded before they reach the parser. */
exports.CSV_IMPORT_MAX_FILE_SIZE = 5 * 1024 * 1024;
const csvUploadLimits = {
    files: 1,
    fileSize: exports.CSV_IMPORT_MAX_FILE_SIZE,
    fields: 1,
    fieldSize: 16 * 1024,
};
const csvUpload = (0, multer_1.default)({
    dest: csvUploadDestination,
    limits: csvUploadLimits,
});
function uploadCSV(destination) {
    return (req, res, next) => {
        csvUpload.single('file')(req, res, (error) => {
            if (!error)
                return next();
            const message = error?.code === 'LIMIT_FILE_SIZE'
                ? `${destination} CSV must be 5 MB or smaller`
                : error?.message || `${destination} CSV upload failed`;
            const respond = () => res.status(400).json({
                error: { code: 'INVALID_UPLOAD', message },
                imported: 0,
                skipped: 0,
                errors: [message],
                total: 0,
            });
            // Multer removes files it has accepted when it aborts. If a file was
            // attached before another multipart limit failed, clean that path too.
            if (req.file?.path) {
                void fs_1.default.promises.unlink(req.file.path).catch(() => undefined).finally(respond);
            }
            else {
                respond();
            }
        });
    };
}
function uploadComponentCSV(req, res, next) {
    uploadCSV('Component')(req, res, next);
}
exports.COMPONENT_IMPORT_FIELDS = [
    'component_code',
    'component_name',
    'component_type',
    'component_category',
    'description',
    'primary_material_code',
    'standard_size',
    'weight_kg',
    'unit',
    'status',
    'notes',
    'synonyms',
    'cost',
    'sell_price',
    'manufacturer',
    'model',
];
const REQUIRED_COMPONENT_IMPORT_FIELDS = ['component_code', 'component_name'];
const COMPONENT_IMPORT_FIELD_SET = new Set(exports.COMPONENT_IMPORT_FIELDS);
function parseCSVFileWithHeaders(filePath, strict = false) {
    return new Promise((resolve, reject) => {
        const rows = [];
        let headers = [];
        fs_1.default.createReadStream(filePath)
            .pipe((0, csv_parser_1.default)({ strict }))
            .on('headers', parsedHeaders => {
            headers = parsedHeaders.map((header) => header.replace(/^\uFEFF/, '').trim());
        })
            .on('data', row => {
            const normalizedRow = {};
            Object.entries(row).forEach(([key, value]) => {
                normalizedRow[key.replace(/^\uFEFF/, '').trim()] = String(value ?? '');
            });
            rows.push(normalizedRow);
        })
            .on('end', () => resolve({ rows, headers }))
            .on('error', reject);
    });
}
function requiredCSVHeaderErrors(headers, requiredFields, destination) {
    const normalizedHeaders = new Set(headers.map(header => header.replace(/^\uFEFF/, '').trim()));
    return requiredFields
        .filter(field => !normalizedHeaders.has(field))
        .map(field => `Required ${destination} CSV column "${field}" is missing`);
}
function rowValue(row, field) {
    return String(row[field] ?? '').trim();
}
function normalizeCSVRows(rows) {
    return rows.map(row => Object.fromEntries(Object.entries(row).map(([field, value]) => [field, String(value ?? '').trim()])));
}
function validateUnpaddedFields(rows, destination, fields) {
    const errors = [];
    rows.forEach((row, index) => {
        fields.forEach(field => {
            const rawValue = String(row[field] ?? '');
            if (rawValue && rawValue !== rawValue.trim()) {
                errors.push(`${destination} CSV row ${index + 2} field "${field}" must not have leading or trailing whitespace`);
            }
        });
    });
    return errors;
}
function validateCSVRows(rows, destination, requiredFields, numericFields = []) {
    const errors = [];
    rows.forEach((row, index) => {
        const rowNumber = index + 2;
        requiredFields.forEach(field => {
            if (!rowValue(row, field)) {
                errors.push(`${destination} CSV row ${rowNumber} field "${field}" is required`);
            }
        });
        numericFields.forEach(field => {
            const value = rowValue(row, field);
            if (value && !Number.isFinite(Number(value))) {
                errors.push(`${destination} CSV row ${rowNumber} field "${field}" must be a valid number`);
            }
        });
    });
    return errors;
}
function csvRowValidationResponse(res, destination, errors, total) {
    return res.status(400).json({
        error: {
            code: 'INVALID_CSV',
            message: `${destination} CSV row validation failed: ${errors.join('; ')}`,
            details: errors,
        },
        imported: 0,
        skipped: 0,
        errors,
        total,
    });
}
function csvImportFailureResponse(res, destination, error, total, results) {
    const reason = error?.message || 'database write failed';
    const message = `${destination} CSV import failed; no rows were imported. Please retry the upload. ${reason}`;
    return res.status(500).json({
        error: { code: 'IMPORT_FAILED', message, details: [reason] },
        imported: 0,
        skipped: results.skipped,
        errors: [...results.errors, message],
        total,
    });
}
async function validateProjectReferences(rows, destination) {
    const errors = [];
    const projectCodes = new Set();
    for (const row of rows) {
        const projectCode = rowValue(row, 'project_code');
        if (projectCode)
            projectCodes.add(projectCode);
    }
    const knownProjects = new Set();
    for (const projectCode of projectCodes) {
        const project = await (0, db_1.query)('SELECT id FROM projects WHERE project_code=$1', [projectCode]);
        if (project.rows[0]) {
            knownProjects.add(projectCode);
        }
    }
    rows.forEach((row, index) => {
        const projectCode = rowValue(row, 'project_code');
        if (projectCode && !knownProjects.has(projectCode)) {
            errors.push(`${destination} CSV row ${index + 2} field "project_code": project "${projectCode}" was not found`);
        }
    });
    return errors;
}
function parseSelectedComponentFields(rawFields) {
    if (rawFields === undefined || rawFields === null || rawFields === '') {
        return { fields: [...exports.COMPONENT_IMPORT_FIELDS] };
    }
    let parsed = rawFields;
    if (typeof rawFields === 'string') {
        try {
            parsed = JSON.parse(rawFields);
        }
        catch {
            return { error: 'fields must be a JSON array of supported component field names' };
        }
    }
    if (!Array.isArray(parsed) || parsed.some(field => typeof field !== 'string')) {
        return { error: 'fields must be a JSON array of supported component field names' };
    }
    const fields = parsed.map(field => String(field).trim());
    const unknownFields = fields.filter(field => !COMPONENT_IMPORT_FIELD_SET.has(field));
    if (unknownFields.length > 0) {
        return { error: `Unsupported component field(s): ${unknownFields.join(', ')}` };
    }
    if (new Set(fields).size !== fields.length) {
        return { error: 'fields must not contain duplicates' };
    }
    const missingRequired = REQUIRED_COMPONENT_IMPORT_FIELDS.filter(field => !fields.includes(field));
    if (missingRequired.length > 0) {
        return { error: `Required component field(s) cannot be cleared: ${missingRequired.join(', ')}` };
    }
    return { fields };
}
function parseNullableNumber(value, field, rowNumber) {
    if (value === undefined || value === null || String(value).trim() === '') {
        return { value: null };
    }
    const parsed = Number(String(value).trim());
    if (!Number.isFinite(parsed)) {
        return { value: null, error: `Row ${rowNumber}: ${field} must be a valid number` };
    }
    return { value: parsed };
}
function parseSynonyms(value) {
    if (value === undefined || value === null || String(value).trim() === '')
        return [];
    return String(value)
        .split(';')
        .map(item => item.trim())
        .filter(Boolean);
}
function csvHeaderError(headers, selectedFields) {
    const errors = [];
    const seen = new Set();
    for (const header of headers) {
        if (!header) {
            errors.push('CSV contains a blank column header');
            continue;
        }
        if (seen.has(header)) {
            errors.push(`CSV contains duplicate column "${header}"`);
        }
        seen.add(header);
        if (!COMPONENT_IMPORT_FIELD_SET.has(header)) {
            errors.push(`Unknown component CSV column "${header}"`);
        }
        else if (!selectedFields.includes(header)) {
            errors.push(`CSV column "${header}" was not selected for import`);
        }
    }
    for (const field of REQUIRED_COMPONENT_IMPORT_FIELDS) {
        if (!headers.includes(field))
            errors.push(`Required CSV column "${field}" is missing`);
    }
    return errors;
}
/**
 * CSV imports are high-impact PIM mutations. Keep this guard on the router so
 * every current and future import destination requires the same admin/manage
 * permission before multer accepts an upload or a handler can write data.
 */
router.use(auth_1.authenticate, (0, auth_1.requireImportManage)('pim'));
router.post('/products', uploadCSV('Product'), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'CSV file required' } });
    const results = { imported: 0, skipped: 0, errors: [] };
    let writePhaseStarted = false;
    let totalRows = 0;
    try {
        const { rows, headers } = await parseCSVFileWithHeaders(req.file.path, true);
        totalRows = rows.length;
        const headerErrors = requiredCSVHeaderErrors(headers, ['product_code', 'product_name'], 'product');
        if (headerErrors.length > 0) {
            return res.status(400).json({
                error: { code: 'INVALID_CSV', message: headerErrors.join('; '), details: headerErrors },
                imported: 0,
                skipped: 0,
                errors: headerErrors,
                total: rows.length,
            });
        }
        const normalizedRows = normalizeCSVRows(rows);
        const rowErrors = validateCSVRows(normalizedRows, 'Product', ['product_code', 'product_name'], ['design_flow_m3h', 'power_kw']);
        if (rowErrors.length > 0) {
            return csvRowValidationResponse(res, 'Product', rowErrors, rows.length);
        }
        writePhaseStarted = true;
        await (0, db_1.withTransaction)(async (client) => {
            for (const row of normalizedRows) {
                const { product_code, product_name, product_family_code, product_category, application_type, design_flow_m3h, power_kw, primary_material_code, standard_status } = row;
                let family_id = null;
                if (product_family_code) {
                    const fam = await client.query('SELECT id FROM product_families WHERE product_family_code=$1', [product_family_code]);
                    if (fam.rows[0])
                        family_id = fam.rows[0].id;
                }
                await client.query('INSERT INTO product_masters (product_code, product_family_id, product_name, product_category, application_type, design_flow_m3h, power_kw, primary_material_code, standard_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (product_code) DO NOTHING', [product_code, family_id, product_name, product_category, application_type, design_flow_m3h || null, power_kw || null, primary_material_code, standard_status || 'Concept']);
                results.imported++;
            }
        });
        return res.json({ ...results, total: rows.length });
    }
    catch (err) {
        if (writePhaseStarted) {
            return csvImportFailureResponse(res, 'Product', err, totalRows, results);
        }
        const message = `Unable to parse Product CSV: ${err?.message || 'invalid CSV data'}`;
        return res.status(400).json({
            error: { code: 'INVALID_CSV', message },
            imported: 0,
            skipped: 0,
            errors: [message],
            total: 0,
        });
    }
    finally {
        await fs_1.default.promises.unlink(req.file.path).catch(() => undefined);
    }
});
router.post('/components', uploadComponentCSV, async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'CSV file required' } });
    const results = { imported: 0, skipped: 0, errors: [] };
    let writePhaseStarted = false;
    let totalRows = 0;
    try {
        const selected = parseSelectedComponentFields(req.body?.fields);
        if (selected.error) {
            return res.status(400).json({
                error: { code: 'INVALID_FIELDS', message: selected.error },
                imported: 0,
                skipped: 0,
                errors: [selected.error],
                total: 0,
            });
        }
        const { rows, headers } = await parseCSVFileWithHeaders(req.file.path);
        totalRows = rows.length;
        const headerErrors = csvHeaderError(headers, selected.fields);
        if (headerErrors.length > 0) {
            return res.status(400).json({
                error: { code: 'INVALID_CSV', message: headerErrors.join('; '), details: headerErrors },
                imported: 0,
                skipped: 0,
                errors: headerErrors,
                total: rows.length,
            });
        }
        const selectedFields = new Set(selected.fields);
        const fileCodes = new Set();
        writePhaseStarted = true;
        await (0, db_1.withTransaction)(async (client) => {
            for (const [index, row] of rows.entries()) {
                const rowNumber = index + 2;
                const componentCode = String(row.component_code ?? '').trim().toUpperCase();
                const componentName = String(row.component_name ?? '').trim();
                if (!componentCode || !componentName) {
                    results.skipped++;
                    results.errors.push(`Row ${rowNumber}: component_code and component_name are required`);
                    continue;
                }
                if (fileCodes.has(componentCode)) {
                    results.skipped++;
                    results.errors.push(`Row ${rowNumber}: component code ${componentCode} is duplicated in this file; row skipped`);
                    continue;
                }
                fileCodes.add(componentCode);
                const existing = await client.query('SELECT id FROM components WHERE UPPER(component_code)=UPPER($1) LIMIT 1', [componentCode]);
                if (existing.rows[0]) {
                    results.skipped++;
                    results.errors.push(`Row ${rowNumber}: component code ${componentCode} already exists; row skipped`);
                    continue;
                }
                const weight = parseNullableNumber(selectedFields.has('weight_kg') ? row.weight_kg : undefined, 'weight_kg', rowNumber);
                const cost = parseNullableNumber(selectedFields.has('cost') ? row.cost : undefined, 'cost', rowNumber);
                const sellPrice = parseNullableNumber(selectedFields.has('sell_price') ? row.sell_price : undefined, 'sell_price', rowNumber);
                const numericError = weight.error || cost.error || sellPrice.error;
                if (numericError) {
                    results.skipped++;
                    results.errors.push(numericError);
                    continue;
                }
                const primaryMaterialCode = selectedFields.has('primary_material_code')
                    ? String(row.primary_material_code ?? '').trim() || null
                    : null;
                if (primaryMaterialCode) {
                    const material = await client.query('SELECT material_code FROM materials WHERE material_code=$1', [primaryMaterialCode]);
                    if (!material.rows[0]) {
                        results.skipped++;
                        results.errors.push(`Row ${rowNumber}: primary_material_code "${primaryMaterialCode}" was not found in materials`);
                        continue;
                    }
                }
                const values = {
                    componentType: selectedFields.has('component_type') ? String(row.component_type ?? '').trim() || 'Vessel' : 'Vessel',
                    componentCategory: selectedFields.has('component_category') ? String(row.component_category ?? '').trim() || 'Mechanical' : 'Mechanical',
                    description: selectedFields.has('description') ? String(row.description ?? '').trim() || null : null,
                    standardSize: selectedFields.has('standard_size') ? String(row.standard_size ?? '').trim() || null : null,
                    unit: selectedFields.has('unit') ? String(row.unit ?? '').trim() || 'EA' : 'EA',
                    status: selectedFields.has('status') ? String(row.status ?? '').trim() || 'Active' : 'Active',
                    notes: selectedFields.has('notes') ? String(row.notes ?? '').trim() || null : null,
                    synonyms: selectedFields.has('synonyms') ? parseSynonyms(row.synonyms) : [],
                    manufacturer: selectedFields.has('manufacturer') ? String(row.manufacturer ?? '').trim() || null : null,
                    model: selectedFields.has('model') ? String(row.model ?? '').trim() || null : null,
                };
                await client.query(`INSERT INTO components
           (component_code, component_name, component_type, component_category, description,
            primary_material_code, standard_size, weight_kg, unit, status, notes, synonyms,
            created_by, cost, sell_price, manufacturer, model)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [
                    componentCode,
                    componentName,
                    values.componentType,
                    values.componentCategory,
                    values.description,
                    primaryMaterialCode,
                    values.standardSize,
                    weight.value,
                    values.unit,
                    values.status,
                    values.notes,
                    values.synonyms,
                    req.user.id,
                    selectedFields.has('cost') && cost.value !== null ? cost.value : 0,
                    selectedFields.has('sell_price') ? sellPrice.value : null,
                    values.manufacturer,
                    values.model,
                ]);
                results.imported++;
            }
        });
        return res.json({ ...results, total: rows.length });
    }
    catch (err) {
        if (writePhaseStarted) {
            return csvImportFailureResponse(res, 'Component', err, totalRows, results);
        }
        console.error('[POST /import/components] error:', err?.message || err);
        return res.status(400).json({
            error: { code: 'INVALID_CSV', message: err?.message || 'Unable to parse component CSV' },
            imported: results.imported,
            skipped: results.skipped,
            errors: [...results.errors, err?.message || 'Unable to parse component CSV'],
            total: 0,
        });
    }
    finally {
        await fs_1.default.promises.unlink(req.file.path).catch(() => undefined);
    }
});
router.post('/equipment', uploadCSV('Equipment'), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'CSV file required' } });
    const results = { imported: 0, skipped: 0, errors: [] };
    let writePhaseStarted = false;
    let totalRows = 0;
    try {
        const { rows, headers } = await parseCSVFileWithHeaders(req.file.path, true);
        totalRows = rows.length;
        const headerErrors = requiredCSVHeaderErrors(headers, ['equipment_code', 'project_code', 'equipment_name'], 'equipment');
        if (headerErrors.length > 0) {
            return res.status(400).json({
                error: { code: 'INVALID_CSV', message: headerErrors.join('; '), details: headerErrors },
                imported: 0,
                skipped: 0,
                errors: headerErrors,
                total: rows.length,
            });
        }
        const normalizedRows = normalizeCSVRows(rows);
        const rowErrors = [
            ...validateCSVRows(normalizedRows, 'Equipment', ['equipment_code', 'project_code', 'equipment_name'], ['design_flow_m3h', 'power_kw']),
            ...validateUnpaddedFields(rows, 'Equipment', ['project_code']),
        ];
        const referenceErrors = await validateProjectReferences(normalizedRows, 'Equipment');
        const validationErrors = [...rowErrors, ...referenceErrors];
        if (validationErrors.length > 0) {
            return csvRowValidationResponse(res, 'Equipment', validationErrors, rows.length);
        }
        writePhaseStarted = true;
        await (0, db_1.withTransaction)(async (client) => {
            for (const row of normalizedRows) {
                const { equipment_code, project_code, system_code, equipment_type, equipment_name, design_flow_m3h, power_kw, material_code } = row;
                const proj = await client.query('SELECT id FROM projects WHERE project_code=$1', [project_code]);
                if (!proj.rows[0])
                    throw new Error(`Equipment ${equipment_code}: project ${project_code} was not found during import`);
                const sys = system_code ? await client.query('SELECT id FROM systems WHERE system_code=$1 AND project_id=$2', [system_code, proj.rows[0].id]) : { rows: [] };
                await client.query('INSERT INTO equipment_instances (equipment_code, project_id, system_id, equipment_type, equipment_name, design_flow_m3h, power_kw, material_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (project_id, equipment_code) DO NOTHING', [equipment_code, proj.rows[0].id, sys.rows[0]?.id || null, equipment_type, equipment_name, design_flow_m3h || null, power_kw || null, material_code]);
                results.imported++;
            }
        });
        return res.json({ ...results, total: rows.length });
    }
    catch (err) {
        if (writePhaseStarted) {
            return csvImportFailureResponse(res, 'Equipment', err, totalRows, results);
        }
        const message = `Unable to parse Equipment CSV: ${err?.message || 'invalid CSV data'}`;
        return res.status(400).json({
            error: { code: 'INVALID_CSV', message },
            imported: 0,
            skipped: 0,
            errors: [message],
            total: 0,
        });
    }
    finally {
        await fs_1.default.promises.unlink(req.file.path).catch(() => undefined);
    }
});
router.post('/documents', uploadCSV('Document'), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'CSV file required' } });
    const results = { imported: 0, skipped: 0, errors: [] };
    let writePhaseStarted = false;
    let totalRows = 0;
    try {
        const { rows, headers } = await parseCSVFileWithHeaders(req.file.path, true);
        totalRows = rows.length;
        const headerErrors = requiredCSVHeaderErrors(headers, ['document_code', 'document_title'], 'document');
        if (headerErrors.length > 0) {
            return res.status(400).json({
                error: { code: 'INVALID_CSV', message: headerErrors.join('; '), details: headerErrors },
                imported: 0,
                skipped: 0,
                errors: headerErrors,
                total: rows.length,
            });
        }
        const normalizedRows = normalizeCSVRows(rows);
        const rowErrors = validateCSVRows(normalizedRows, 'Document', ['document_code', 'document_title']);
        if (rowErrors.length > 0) {
            return csvRowValidationResponse(res, 'Document', rowErrors, rows.length);
        }
        const referenceErrors = await validateProjectReferences(normalizedRows, 'Document');
        if (referenceErrors.length > 0) {
            return csvRowValidationResponse(res, 'Document', referenceErrors, rows.length);
        }
        writePhaseStarted = true;
        await (0, db_1.withTransaction)(async (client) => {
            for (const row of normalizedRows) {
                const { document_code, document_title, document_type, discipline, project_code } = row;
                const proj = project_code ? await client.query('SELECT id FROM projects WHERE project_code=$1', [project_code]) : { rows: [] };
                await client.query('INSERT INTO documents (document_code, document_title, document_type, discipline, project_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (document_code) DO NOTHING', [document_code, document_title, document_type, discipline, proj.rows[0]?.id || null, req.user.id]);
                results.imported++;
            }
        });
        return res.json({ ...results, total: rows.length });
    }
    catch (err) {
        if (writePhaseStarted) {
            return csvImportFailureResponse(res, 'Document', err, totalRows, results);
        }
        const message = `Unable to parse Document CSV: ${err?.message || 'invalid CSV data'}`;
        return res.status(400).json({
            error: { code: 'INVALID_CSV', message },
            imported: 0,
            skipped: 0,
            errors: [message],
            total: 0,
        });
    }
    finally {
        await fs_1.default.promises.unlink(req.file.path).catch(() => undefined);
    }
});
exports.default = router;
