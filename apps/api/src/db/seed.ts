import pool from './index';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Seeding database...');

    // Users
    const adminHash = await bcrypt.hash('admin123', 10);
    const engHash = await bcrypt.hash('engineer123', 10);
    const viewHash = await bcrypt.hash('viewer123', 10);

    await client.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES
        ('admin@edp.com', $1, 'Platform', 'Admin', 'admin'),
        ('engineer@edp.com', $2, 'Alex', 'Chen', 'engineer'),
        ('viewer@edp.com', $3, 'Sam', 'Lee', 'viewer')
      ON CONFLICT (email) DO NOTHING
    `, [adminHash, engHash, viewHash]);

    const adminRes = await client.query(`SELECT id FROM users WHERE email = 'admin@edp.com'`);
    const adminId = adminRes.rows[0].id;
    const engRes = await client.query(`SELECT id FROM users WHERE email = 'engineer@edp.com'`);
    const engId = engRes.rows[0].id;

    // Materials
    await client.query(`
      INSERT INTO materials (material_code, material_name, material_category, density, chemical_resistance, temperature_limit) VALUES
        ('MAT-FRP-VE', 'Vinyl Ester FRP', 'Composite', 1800, 'Excellent - seawater, acids', 80),
        ('MAT-SS316', 'Stainless Steel 316L', 'Metal', 7990, 'Good - seawater, chlorides', 400),
        ('MAT-HDPE', 'High Density Polyethylene', 'Plastic', 960, 'Excellent - most chemicals', 60),
        ('MAT-PP', 'Polypropylene', 'Plastic', 900, 'Good - dilute acids', 70),
        ('MAT-ACRYLIC', 'Cast Acrylic', 'Plastic', 1190, 'Good - seawater', 60),
        ('MAT-CPVC', 'CPVC', 'Plastic', 1540, 'Excellent - acids, bases', 95)
      ON CONFLICT (material_code) DO NOTHING
    `);

    // Specifications
    await client.query(`
      INSERT INTO specifications (spec_code, spec_name, spec_type, standard_reference, discipline) VALUES
        ('SPEC-LSS-001', 'Life Support System Design Standard', 'Design', 'AZA/EAZA LSS Guidelines', 'Mechanical'),
        ('SPEC-PIPE-001', 'Piping Material Standard - Marine', 'Material', 'ASTM D1785', 'Piping'),
        ('SPEC-ELEC-001', 'Electrical Panel Standard', 'Design', 'IEC 61439', 'Electrical'),
        ('SPEC-STRUC-001', 'Tank Structural Standard - FRP', 'Design', 'ASME RTP-1', 'Structural')
      ON CONFLICT (spec_code) DO NOTHING
    `);

    // Design Rules
    await client.query(`
      INSERT INTO design_rules (rule_code, rule_name, discipline, applies_to, rule_description) VALUES
        ('DR-LSS-001', 'Minimum Turnover Rate - Display Tanks', 'Mechanical', 'Tank', 'Display tanks must achieve minimum 3x turnover per hour'),
        ('DR-LSS-002', 'Redundancy - Life Support Pumps', 'Mechanical', 'System', 'Critical LSS pumps must have N+1 redundancy'),
        ('DR-PIPE-001', 'Pipe Material - Seawater Service', 'Piping', 'Equipment', 'Seawater service piping must be FRP-VE or HDPE'),
        ('DR-ELEC-001', 'IP Rating - Wet Areas', 'Electrical', 'Equipment', 'All electrical equipment in wet areas must be minimum IP65')
      ON CONFLICT (rule_code) DO NOTHING
    `);

    // Calculation Templates
    await client.query(`
      INSERT INTO calculation_templates (template_code, template_name, discipline, applies_to, description) VALUES
        ('CALC-LSS-001', 'System Turnover Rate Calculator', 'Mechanical', 'System', 'Calculate tank turnover rate from system flow and tank volume'),
        ('CALC-PUMP-001', 'Pump Sizing - Head Loss Calculation', 'Mechanical', 'Equipment', 'Calculate total system head for pump selection'),
        ('CALC-TANK-001', 'Tank Volume Calculator', 'Structural', 'Tank', 'Calculate gross and operating volumes from dimensions')
      ON CONFLICT (template_code) DO NOTHING
    `);

    // Product Families
    await client.query(`
      INSERT INTO product_families (product_family_code, product_family_name, category_code, status) VALUES
        ('PFM-FF',   'Foam Fractionators', 'FILTRATION',  'Active'),
        ('PFM-PUMP', 'Circulation Pumps',  'PUMPING',     'Active'),
        ('PFM-DRUM', 'Drum Filters',       'FILTRATION',  'Active'),
        ('PFM-UV',   'UV Sterilizers',     'DISINFECTION','Active'),
        ('PFM-HX',   'Heat Exchangers',    'THERMAL',     'Active'),
        ('PFM-OZ',   'Ozone Generators',   'DISINFECTION','Active'),
        ('PFM-PIPE', 'Pipes & Fittings',   'PIPING',      'Active')
      ON CONFLICT (product_family_code) DO NOTHING
    `);

    const ffFamilyRes = await client.query(`SELECT id FROM product_families WHERE product_family_code = 'PFM-FF'`);
    const pumpFamilyRes = await client.query(`SELECT id FROM product_families WHERE product_family_code = 'PFM-PUMP'`);
    const drumFamilyRes = await client.query(`SELECT id FROM product_families WHERE product_family_code = 'PFM-DRUM'`);
    const uvFamilyRes = await client.query(`SELECT id FROM product_families WHERE product_family_code = 'PFM-UV'`);
    const pipeFamilyRes = await client.query(`SELECT id FROM product_families WHERE product_family_code = 'PFM-PIPE'`);

    // Product Masters
    await client.query(`
      INSERT INTO product_masters (product_code, product_family_id, product_name, product_category, application_type, design_flow_m3h, power_kw, primary_material_code, standard_status) VALUES
        ('PM-FF-1500',      $1, 'Foam Fractionator FF-1500',   'Filtration', 'Marine Display',          1500, 7.5,  'MAT-FRP-VE', 'Active'),
        ('PM-FF-800',       $1, 'Foam Fractionator FF-800',    'Filtration', 'Marine Display',           800, 4.0,  'MAT-FRP-VE', 'Active'),
        ('PM-PUMP-CIR-55',  $2, 'Circulation Pump 55kW',       'Pumping',    'LSS Primary',             1200, 55.0, 'MAT-SS316',  'Active'),
        ('PM-PUMP-CIR-22',  $2, 'Circulation Pump 22kW',       'Pumping',    'LSS Primary',              500, 22.0, 'MAT-SS316',  'Active'),
        ('PM-DRUM-60',      $3, 'Drum Filter 60Hz',            'Filtration', 'Mechanical Filtration',    800, 1.5,  'MAT-SS316',  'Active'),
        ('PM-UV-120',       $4, 'UV Sterilizer 120W/m3',       'Disinfection','UV Disinfection',         200, 3.0,  'MAT-SS316',  'Active'),
        ('PM-PIPE-FRP-50',  $5, 'FRP Pipe DN50',               'Piping',     'Seawater / LSS',          NULL, NULL, 'MAT-FRP-VE', 'Active'),
        ('PM-PIPE-FRP-80',  $5, 'FRP Pipe DN80',               'Piping',     'Seawater / LSS',          NULL, NULL, 'MAT-FRP-VE', 'Active'),
        ('PM-PIPE-CPVC-50', $5, 'CPVC Pipe DN50',              'Piping',     'Chemical / LSS',          NULL, NULL, 'MAT-CPVC',   'Active'),
        ('PM-FIT-ELB50',    $5, 'Elbow 90° DN50 FRP',          'Piping',     'Seawater / LSS',          NULL, NULL, 'MAT-FRP-VE', 'Active'),
        ('PM-FIT-TEE50',    $5, 'Tee DN50 FRP',                'Piping',     'Seawater / LSS',          NULL, NULL, 'MAT-FRP-VE', 'Active'),
        ('PM-FIT-RED8050',  $5, 'Reducer DN80×50 FRP',         'Piping',     'Seawater / LSS',          NULL, NULL, 'MAT-FRP-VE', 'Active'),
        ('PM-FIT-UNI50',    $5, 'Union Connector DN50 CPVC',   'Piping',     'LSS / Chemical',          NULL, NULL, 'MAT-CPVC',   'Active'),
        ('PM-FIT-FLG80',    $5, 'Flange PN10 DN80 FRP',        'Piping',     'Seawater',                NULL, NULL, 'MAT-FRP-VE', 'Active')
      ON CONFLICT (product_code) DO NOTHING
    `, [ffFamilyRes.rows[0].id, pumpFamilyRes.rows[0].id, drumFamilyRes.rows[0].id, uvFamilyRes.rows[0].id, pipeFamilyRes.rows[0].id]);

    // Components
    await client.query(`
      INSERT INTO components (component_code, component_name, component_type, component_category, description, primary_material_code, standard_size, weight_kg, unit, status, notes, created_by) VALUES
        ('COMP-VEN-50',      'Venturi Injector DN50',           'Instrument', 'Mechanical',       'Venturi-type air-water mixing injector, key functional element of foam fractionators. Creates micro-bubble dispersion for protein skimming.',                            'MAT-FRP-VE', 'DN50',                          1.2,  'EA', 'Active', 'Matched pair with reaction column. Operating pressure 0.5–2.5 bar.',              $1),
        ('COMP-VES-FF1500',  'FRP-VE Reaction Column 1500L',    'Vessel',     'Mechanical',       'Primary reaction vessel for FF-1500 foam fractionator. Cylindrical FRP-VE column where bubble/water contact occurs.',                                                  'MAT-FRP-VE', '1500L / Ø600mm × H2400mm',     48.0, 'EA', 'Active', 'Full system weight inc. water: ~2200 kg. Flanged DN80 connections.',              $1),
        ('COMP-VES-FF800',   'FRP-VE Reaction Column 800L',     'Vessel',     'Mechanical',       'Smaller reaction vessel for FF-800 foam fractionator.',                                                                                                                  'MAT-FRP-VE', '800L / Ø450mm × H1800mm',      28.0, 'EA', 'Active', 'Full system weight inc. water: ~1050 kg. Flanged DN50 connections.',              $1),
        ('COMP-BLW-22',      'Air Blower 2.2kW',                'Blower',     'Mechanical',       'Side-channel air blower, oil-free, for feeding venturi injector. Delivers clean dry air at 0.4–0.6 bar.',                                                              NULL,         '2.2 kW / DN50 air outlet',      14.5, 'EA', 'Active', 'Mounted on anti-vibration pads. Connect to COMP-VEN-50 via DN25 air line.',        $1),
        ('COMP-BLW-11',      'Air Blower 1.1kW',                'Blower',     'Mechanical',       'Side-channel air blower for FF-800. Oil-free, delivers air at 0.4–0.6 bar via DN25 outlet.',                                                                           NULL,         '1.1 kW / DN25 air outlet',       8.2,  'EA', 'Active', 'Paired with COMP-VEN-50 at lower flow rate.',                                     $1),
        ('COMP-FMT-DN50',    'Flow Meter DN50 (Rotameter)',      'Instrument', 'Instrumentation',  'Variable-area rotameter for measuring seawater inlet flow to foam fractionator. FRP body, ball-float.',                                                                'MAT-FRP-VE', 'DN50, 0–30 m³/h',               1.8,  'EA', 'Active', 'Calibrated range 5–25 m³/h. ANSI flanged connections.',                           $1),
        ('COMP-VLV-BL50',    'Ball Valve DN50 FRP',              'Valve',      'Piping',           'Full-bore ball valve for isolation and flow throttling on seawater lines. FRP body, PTFE-lined.',                                                                       'MAT-FRP-VE', 'DN50 PN10',                      2.4,  'EA', 'Active', 'Lever operated. Working pressure 10 bar. Suitable for seawater and brine.',       $1),
        ('COMP-VLV-BL80',    'Ball Valve DN80 FRP',              'Valve',      'Piping',           'Full-bore ball valve DN80 for pump isolation. FRP body, PTFE seats.',                                                                                                  'MAT-FRP-VE', 'DN80 PN10',                      4.5,  'EA', 'Active', 'Gear-operated on sizes DN80 and above.',                                           $1),
        ('COMP-VLV-AIR25',   'Air Inlet Valve DN25 CPVC',        'Valve',      'Piping',           'Manual needle valve for controlling air flow rate from blower to venturi. CPVC body, stainless needle.',                                                               'MAT-CPVC',   'DN25',                           0.6,  'EA', 'Active', 'Fine adjustment valve — set during commissioning. Lock-wire after setting.',      $1),
        ('COMP-PRV-50',      'Pressure Relief Valve DN50',        'Valve',      'Mechanical',       'Spring-loaded pressure relief valve on pump discharge. Set to 3.5 bar.',                                                                                               'MAT-SS316',  'DN50, 0.5–4 bar adj.',           1.8,  'EA', 'Active', 'Test annually. Calibration sticker required after each test.',                    $1),
        ('COMP-CUP-FF',      'Collection Cup Assembly',           'Vessel',     'Mechanical',       'Removable foam collection cup with neck tube for FF series. Collects concentrated DOC/protein foam for disposal.',                                                     'MAT-ACRYLIC','Ø200mm × H450mm',               3.2,  'EA', 'Active', 'Fitted with drain valve and sight glass. Clean weekly under normal bioload.',     $1),
        ('COMP-DIFF-FF',     'Bubble Diffuser Plate',             'Other',      'Mechanical',       'Perforated distribution plate at base of reaction column. Ensures uniform micro-bubble distribution across column cross-section.',                                     'MAT-FRP-VE', 'Ø590mm, 1mm holes @ 10mm pitch', 0.8,  'EA', 'Active', 'Replace when hole enlargement exceeds 1.5mm or foam quality degrades.',          $1),
        ('COMP-IMP-22',      'Pump Impeller 22kW',                'Other',      'Mechanical',       'Stainless steel impeller for 22kW circulation pump. Fitted with wear-resistant coating for seawater service.',                                                        'MAT-SS316',  'Ø210mm, 6-vane',                 4.5,  'EA', 'Active', 'Replace if erosion exceeds 0.5mm or pump head drops >10% from baseline.',        $1),
        ('COMP-SEAL-22',     'Mechanical Seal — 22kW Pump',       'Other',      'Mechanical',       'Silicon carbide / carbon mechanical shaft seal for seawater circulation pump.',                                                                                        NULL,         'Ø35mm shaft, SiC/C faces',       0.3,  'EA', 'Active', 'Replace every 12 months or at first sign of leak. Spare kept in stores.',        $1),
        ('COMP-PIPE-FRP50',  'FRP Pipe DN50 (per metre)',          'Pipe',       'Piping',           'Filament-wound FRP vinyl ester pipe, DN50 (2-inch nominal), PN16. Standard length 3m or 6m.',                                                                        'MAT-FRP-VE', 'DN50 / OD 63mm / WT 4mm',       0.9,  'm',  'Active', 'Cut to length on site. Pressure test at 24 bar.',                                 $1),
        ('COMP-PIPE-FRP80',  'FRP Pipe DN80 (per metre)',          'Pipe',       'Piping',           'Filament-wound FRP vinyl ester pipe, DN80 (3-inch nominal), PN16. Standard length 6m.',                                                                              'MAT-FRP-VE', 'DN80 / OD 90mm / WT 5mm',       1.6,  'm',  'Active', 'Header pipe for LSS ring main. Supports flow up to 45 m³/h.',                    $1),
        ('COMP-PIPE-CPVC50', 'CPVC Pipe DN50 (per metre)',         'Pipe',       'Piping',           'CPVC schedule 80 pressure pipe DN50. Suitable for chemical dosing and ozone service up to 93°C.',                                                                     'MAT-CPVC',   'DN50 / OD 60.3mm / WT 5.5mm',   0.7,  'm',  'Active', 'Solvent-cement or threaded joints. UV-stabilised for exposed runs.',              $1),
        ('COMP-ELB-FRP50',   '90° Elbow DN50 FRP',                'Fitting',    'Piping',           'Short-radius 90-degree elbow, DN50, FRP vinyl ester, PN16.',                                                                                                          'MAT-FRP-VE', 'DN50 SR90',                      0.4,  'EA', 'Active', NULL,                                                                              $1),
        ('COMP-ELB-FRP80',   '90° Elbow DN80 FRP',                'Fitting',    'Piping',           'Short-radius 90-degree elbow, DN80, FRP vinyl ester, PN16.',                                                                                                          'MAT-FRP-VE', 'DN80 SR90',                      0.8,  'EA', 'Active', NULL,                                                                              $1),
        ('COMP-TEE-FRP50',   'Tee DN50 FRP',                       'Fitting',    'Piping',           'Equal tee junction DN50 FRP vinyl ester, PN16. All butt-weld ends.',                                                                                                 'MAT-FRP-VE', 'DN50 EQ-T',                      0.5,  'EA', 'Active', NULL,                                                                              $1),
        ('COMP-RED-8050',    'Reducer DN80×50 FRP',                 'Fitting',    'Piping',           'Concentric reducer DN80 to DN50, FRP vinyl ester. Used at pump outlets.',                                                                                             'MAT-FRP-VE', 'DN80×50',                         0.6,  'EA', 'Active', NULL,                                                                              $1),
        ('COMP-UNI-CPVC50',  'Union Connector DN50 CPVC',           'Fitting',    'Piping',           'True-union connector for break-out maintenance access. CPVC, EPDM o-ring.',                                                                                          'MAT-CPVC',   'DN50',                           0.3,  'EA', 'Active', 'Install on inlet/outlet of all major equipment for service isolation.',           $1),
        ('COMP-FLG-FRP80',   'Flange PN10 DN80 FRP',                'Fitting',    'Piping',           'Flat-face flange DN80 PN10 FRP, drilled to DIN 2501. Bonded to pipe or moulded integral.',                                                                           'MAT-FRP-VE', 'DN80 PN10',                      1.1,  'EA', 'Active', NULL,                                                                              $1)
      ON CONFLICT (component_code) DO NOTHING
    `, [adminId]);

    // Vendor Options
    await client.query(`
      INSERT INTO vendor_options (vendor_option_code, product_master_id, vendor_name, manufacturer_name, vendor_item_code, approved_status, lead_time_days) VALUES
        ('VO-FF-1500-01', (SELECT id FROM product_masters WHERE product_code='PM-FF-1500'), 'AquaTech Asia', 'AquaTech', 'AT-FF-1500-MK2', 'Approved', 90),
        ('VO-FF-1500-02', (SELECT id FROM product_masters WHERE product_code='PM-FF-1500'), 'Marine Systems Ltd', 'MSL', 'MSL-PS-1500', 'Approved', 120),
        ('VO-PUMP-55-01', (SELECT id FROM product_masters WHERE product_code='PM-PUMP-CIR-55'), 'Grundfos', 'Grundfos', 'NK-55-200', 'Approved', 60)
      ON CONFLICT (vendor_option_code) DO NOTHING
    `);

    // Standard BOMs
    await client.query(`
      INSERT INTO standard_boms (bom_code, product_master_id, revision_code)
      SELECT t.code, pm.id, 'A'
      FROM (VALUES
        ('BOM-FF-1500-A',  'PM-FF-1500'),
        ('BOM-FF-800-A',   'PM-FF-800'),
        ('BOM-PUMP-22-A',  'PM-PUMP-CIR-22'),
        ('BOM-PUMP-55-A',  'PM-PUMP-CIR-55')
      ) AS t(code, pcode)
      JOIN product_masters pm ON pm.product_code = t.pcode
      WHERE NOT EXISTS (SELECT 1 FROM standard_boms WHERE bom_code = t.code)
    `);

    // FF-1500 BOM lines (10 lines with component_id links)
    await client.query(`
      INSERT INTO bom_lines (standard_bom_id, component_id, line_number, component_type, component_reference_code, component_name, quantity, unit, is_optional, remarks)
      SELECT sb.id, c.id, t.ln, t.ctype, t.cref, t.cname, t.qty, t.unit, t.opt, t.remarks
      FROM standard_boms sb
      JOIN product_masters pm ON sb.product_master_id = pm.id
      CROSS JOIN (VALUES
        (1,  'Vessel',     'COMP-VES-FF1500', 'FRP-VE Reaction Column 1500L',   1,   'EA', false, 'Main reaction vessel body'),
        (2,  'Blower',     'COMP-BLW-22',     'Air Blower 2.2kW',              2,   'EA', false, 'Blower pair for air feed'),
        (3,  'Instrument', 'COMP-FMT-DN50',   'Flow Meter DN50 (Rotameter)',    1,   'EA', false, ''),
        (4,  'Valve',      'COMP-VLV-BL50',   'Ball Valve DN50 FRP',           4,   'EA', false, 'Inlet/outlet and bypass'),
        (5,  'Instrument', 'COMP-VEN-50',     'Venturi Injector DN50',          1,   'EA', false, 'Core air-water mixing element'),
        (6,  'Vessel',     'COMP-CUP-FF',     'Collection Cup Assembly',        1,   'EA', false, 'Includes neck tube and drain valve'),
        (7,  'Other',      'COMP-DIFF-FF',    'Bubble Diffuser Plate',          1,   'EA', false, 'Ø590mm perforated plate at column base'),
        (8,  'Valve',      'COMP-VLV-AIR25',  'Air Inlet Valve DN25 CPVC',     1,   'EA', false, 'Fine-adjust air flow control'),
        (9,  'Pipe',       'COMP-PIPE-FRP50', 'FRP Pipe DN50 Inlet/Outlet',    2,   'm',  false, 'Water inlet and outlet spools'),
        (10, 'Fitting',    'COMP-UNI-CPVC50', 'Union Connector DN50 CPVC',     2,   'EA', false, 'Service isolation unions')
      ) AS t(ln, ctype, cref, cname, qty, unit, opt, remarks)
      JOIN components c ON c.component_code = t.cref
      WHERE pm.product_code = 'PM-FF-1500'
        AND NOT EXISTS (SELECT 1 FROM bom_lines x WHERE x.standard_bom_id = sb.id AND x.line_number = t.ln)
    `);

    // FF-800 BOM lines (9 lines)
    await client.query(`
      INSERT INTO bom_lines (standard_bom_id, component_id, line_number, component_type, component_reference_code, component_name, quantity, unit, is_optional, remarks)
      SELECT sb.id, c.id, t.ln, t.ctype, t.cref, t.cname, t.qty, t.unit, t.opt, t.remarks
      FROM standard_boms sb
      JOIN product_masters pm ON sb.product_master_id = pm.id
      CROSS JOIN (VALUES
        (1, 'Vessel',     'COMP-VES-FF800',  'FRP-VE Reaction Column 800L',   1, 'EA', false, 'Main reaction vessel body'),
        (2, 'Instrument', 'COMP-VEN-50',     'Venturi Injector DN50',          1, 'EA', false, 'Same venturi as FF-1500 — lower air flow duty'),
        (3, 'Blower',     'COMP-BLW-11',     'Air Blower 1.1kW',              1, 'EA', false, ''),
        (4, 'Instrument', 'COMP-FMT-DN50',   'Flow Meter DN50 (Rotameter)',    1, 'EA', false, ''),
        (5, 'Valve',      'COMP-VLV-BL50',   'Ball Valve DN50 FRP',           2, 'EA', false, 'Inlet and outlet isolation'),
        (6, 'Vessel',     'COMP-CUP-FF',     'Collection Cup Assembly',        1, 'EA', false, ''),
        (7, 'Other',      'COMP-DIFF-FF',    'Bubble Diffuser Plate',          1, 'EA', false, 'Ø440mm variant for 800L column'),
        (8, 'Pipe',       'COMP-PIPE-FRP50', 'FRP Pipe DN50 Inlet/Outlet',    1, 'm',  false, ''),
        (9, 'Fitting',    'COMP-UNI-CPVC50', 'Union Connector DN50 CPVC',     2, 'EA', false, '')
      ) AS t(ln, ctype, cref, cname, qty, unit, opt, remarks)
      JOIN components c ON c.component_code = t.cref
      WHERE pm.product_code = 'PM-FF-800'
        AND NOT EXISTS (SELECT 1 FROM bom_lines x WHERE x.standard_bom_id = sb.id AND x.line_number = t.ln)
    `);

    // Pump-22 BOM lines (7 lines)
    await client.query(`
      INSERT INTO bom_lines (standard_bom_id, component_id, line_number, component_type, component_reference_code, component_name, quantity, unit, is_optional, remarks)
      SELECT sb.id, c.id, t.ln, t.ctype, t.cref, t.cname, t.qty, t.unit, t.opt, t.remarks
      FROM standard_boms sb
      JOIN product_masters pm ON sb.product_master_id = pm.id
      CROSS JOIN (VALUES
        (1, 'Other',   'COMP-IMP-22',    'Pump Impeller 22kW SS316',      1,   'EA', false, 'Replace if head drops >10% from baseline'),
        (2, 'Other',   'COMP-SEAL-22',   'Mechanical Seal — 22kW Pump',   2,   'EA', false, 'Spare set should be kept in stores'),
        (3, 'Valve',   'COMP-VLV-BL80',  'Ball Valve DN80 FRP',           2,   'EA', false, 'Suction and discharge isolation'),
        (4, 'Valve',   'COMP-PRV-50',    'Pressure Relief Valve DN50',    1,   'EA', false, 'Set 3.5 bar — test annually'),
        (5, 'Pipe',    'COMP-PIPE-FRP80','FRP Pipe DN80 (per metre)',     0.5, 'm',  false, 'Short spool pieces at pump flanges'),
        (6, 'Fitting', 'COMP-FLG-FRP80', 'Flange PN10 DN80 FRP',         2,   'EA', false, 'Suction and discharge flanges'),
        (7, 'Fitting', 'COMP-RED-8050',  'Reducer DN80×50 FRP',           1,   'EA', true,  'Required when connecting to DN50 ring main')
      ) AS t(ln, ctype, cref, cname, qty, unit, opt, remarks)
      JOIN components c ON c.component_code = t.cref
      WHERE pm.product_code = 'PM-PUMP-CIR-22'
        AND NOT EXISTS (SELECT 1 FROM bom_lines x WHERE x.standard_bom_id = sb.id AND x.line_number = t.ln)
    `);

    // Project: Taoyuan Aquarium
    await client.query(`
      INSERT INTO projects (project_code, project_name, client_name, site_name, country, city, project_status, start_date, target_completion_date, project_manager, engineering_manager, created_by) VALUES
        ('PRJ-TY-001', 'Taoyuan Aquarium', 'Taoyuan City Government', 'Taoyuan Aquarium Site', 'Taiwan', 'Taoyuan', 'Active', '2024-01-15', '2025-06-30', 'David Wang', 'Sarah Chen', $1)
      ON CONFLICT (project_code) DO NOTHING
    `, [adminId]);

    const projRes = await client.query(`SELECT id FROM projects WHERE project_code = 'PRJ-TY-001'`);
    const projId = projRes.rows[0].id;

    // Areas
    await client.query(`
      INSERT INTO areas (area_code, project_id, area_name, discipline_scope) VALUES
        ('ARE-SHARK-01', $1, 'Shark Exhibit Area', 'Mechanical, Electrical, Civil'),
        ('ARE-TROP-01', $1, 'Tropical Reef Area', 'Mechanical, Electrical'),
        ('ARE-JELLY-01', $1, 'Jellyfish Gallery', 'Mechanical, Electrical'),
        ('ARE-UTIL-01', $1, 'Utility & Plant Room', 'Mechanical, Electrical, Piping')
      ON CONFLICT DO NOTHING
    `, [projId]);

    const sharkAreaRes = await client.query(`SELECT id FROM areas WHERE project_id=$1 AND area_code='ARE-SHARK-01'`, [projId]);
    const tropAreaRes = await client.query(`SELECT id FROM areas WHERE project_id=$1 AND area_code='ARE-TROP-01'`, [projId]);
    const jellyAreaRes = await client.query(`SELECT id FROM areas WHERE project_id=$1 AND area_code='ARE-JELLY-01'`, [projId]);
    const sharkAreaId = sharkAreaRes.rows[0].id;
    const tropAreaId = tropAreaRes.rows[0].id;
    const jellyAreaId = jellyAreaRes.rows[0].id;

    // Exhibits
    await client.query(`
      INSERT INTO exhibits (exhibit_code, project_id, area_id, exhibit_name, water_type, design_temperature_min, design_temperature_max, design_salinity) VALUES
        ('EXH-SHARK-01', $1, $2, 'Main Shark Exhibit', 'Marine', 22, 26, 33),
        ('EXH-TROP-01', $1, $3, 'Tropical Reef Exhibit', 'Marine', 24, 28, 35),
        ('EXH-JELLY-01', $1, $4, 'Jellyfish Moon Exhibit', 'Marine', 18, 22, 30)
      ON CONFLICT DO NOTHING
    `, [projId, sharkAreaId, tropAreaId, jellyAreaId]);

    const sharkExhRes = await client.query(`SELECT id FROM exhibits WHERE project_id=$1 AND exhibit_code='EXH-SHARK-01'`, [projId]);
    const tropExhRes = await client.query(`SELECT id FROM exhibits WHERE project_id=$1 AND exhibit_code='EXH-TROP-01'`, [projId]);
    const jellyExhRes = await client.query(`SELECT id FROM exhibits WHERE project_id=$1 AND exhibit_code='EXH-JELLY-01'`, [projId]);
    const sharkExhId = sharkExhRes.rows[0].id;
    const tropExhId = tropExhRes.rows[0].id;
    const jellyExhId = jellyExhRes.rows[0].id;

    // Tanks
    await client.query(`
      INSERT INTO tanks (tank_code, project_id, area_id, exhibit_id, tank_name, tank_type, shape_type, gross_volume_m3, operating_volume_m3, length_mm, width_mm, height_mm, primary_material) VALUES
        ('TNK-SHARK-01', $1, $2, $3, 'Main Shark Display Tank', 'Display', 'Rectangular', 518, 450, 18000, 8000, 4000, 'FRP-VE'),
        ('TNK-SHARK-02', $1, $2, $3, 'Shark Holding Tank A', 'Holding', 'Circular', 85, 70, 6000, 6000, 3500, 'FRP-VE'),
        ('TNK-TROP-01', $1, $4, $5, 'Tropical Reef Display', 'Display', 'Irregular', 320, 280, 12000, 6000, 3200, 'Acrylic/FRP'),
        ('TNK-JELLY-01', $1, $6, $7, 'Jellyfish Display Cylinder', 'Display', 'Cylindrical', 12, 10, 1800, 1800, 2400, 'Acrylic')
      ON CONFLICT DO NOTHING
    `, [projId, sharkAreaId, sharkExhId, tropAreaId, tropExhId, jellyAreaId, jellyExhId]);

    // Systems
    await client.query(`
      INSERT INTO systems (system_code, project_id, area_id, exhibit_id, system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type, status) VALUES
        ('SYS-LSS-SHARK-01', $1, $2, $3, 'Shark LSS - Primary Filtration', 'Life Support', 1500, 3.0, 'Marine', 'Draft'),
        ('SYS-LSS-TROP-01', $1, $4, $5, 'Tropical Reef LSS', 'Life Support', 800, 3.5, 'Marine', 'Draft'),
        ('SYS-LSS-JELLY-01', $1, $6, $7, 'Jellyfish LSS', 'Life Support', 120, 12.0, 'Marine', 'Draft'),
        ('SYS-UTIL-CW-01', $1, $8, NULL, 'Chilled Water Distribution', 'Utility', 500, NULL, 'Freshwater', 'Draft')
      ON CONFLICT DO NOTHING
    `, [projId, sharkAreaId, sharkExhId, tropAreaId, tropExhId, jellyAreaId, jellyExhId,
        (await client.query(`SELECT id FROM areas WHERE project_id=$1 AND area_code='ARE-UTIL-01'`, [projId])).rows[0].id]);

    const sys1Res = await client.query(`SELECT id FROM systems WHERE project_id=$1 AND system_code='SYS-LSS-SHARK-01'`, [projId]);
    const sys2Res = await client.query(`SELECT id FROM systems WHERE project_id=$1 AND system_code='SYS-LSS-TROP-01'`, [projId]);
    const sys1Id = sys1Res.rows[0].id;
    const sys2Id = sys2Res.rows[0].id;

    // Equipment Instances
    await client.query(`
      INSERT INTO equipment_instances (equipment_code, project_id, system_id, equipment_type, equipment_name, design_flow_m3h, power_kw, material_code, status) VALUES
        ('EQI-TY-SHARK-FF-01', $1, $2, 'Foam Fractionator', 'Shark LSS Foam Fractionator 01', 1500, 7.5, 'MAT-FRP-VE', 'Draft'),
        ('EQI-TY-SHARK-FF-02', $1, $2, 'Foam Fractionator', 'Shark LSS Foam Fractionator 02 (Standby)', 1500, 7.5, 'MAT-FRP-VE', 'Draft'),
        ('EQI-TY-SHARK-PUMP-01', $1, $2, 'Circulation Pump', 'Shark Primary Circ Pump A', 1500, 55.0, 'MAT-SS316', 'Draft'),
        ('EQI-TY-SHARK-PUMP-02', $1, $2, 'Circulation Pump', 'Shark Primary Circ Pump B (Standby)', 1500, 55.0, 'MAT-SS316', 'Draft'),
        ('EQI-TY-SHARK-DRUM-01', $1, $2, 'Drum Filter', 'Shark Drum Filter 01', 800, 1.5, 'MAT-SS316', 'Draft'),
        ('EQI-TY-SHARK-UV-01', $1, $2, 'UV Sterilizer', 'Shark UV Sterilizer 01', 200, 3.0, 'MAT-SS316', 'Draft'),
        ('EQI-TY-TROP-FF-01', $1, $3, 'Foam Fractionator', 'Tropical LSS Foam Fractionator', 800, 4.0, 'MAT-FRP-VE', 'Draft'),
        ('EQI-TY-TROP-PUMP-01', $1, $3, 'Circulation Pump', 'Tropical Primary Circ Pump', 800, 22.0, 'MAT-SS316', 'Draft')
      ON CONFLICT DO NOTHING
    `, [projId, sys1Id, sys2Id]);

    // Product Usages (bridge)
    const ff1500Res = await client.query(`SELECT id FROM product_masters WHERE product_code='PM-FF-1500'`);
    const pump55Res = await client.query(`SELECT id FROM product_masters WHERE product_code='PM-PUMP-CIR-55'`);
    const ff1500Id = ff1500Res.rows[0].id;
    const pump55Id = pump55Res.rows[0].id;

    await client.query(`
      INSERT INTO product_usages (project_id, product_master_id, equipment_instance_id) VALUES
        ($1, $2, (SELECT id FROM equipment_instances WHERE equipment_code='EQI-TY-SHARK-FF-01')),
        ($1, $2, (SELECT id FROM equipment_instances WHERE equipment_code='EQI-TY-SHARK-FF-02')),
        ($1, $3, (SELECT id FROM equipment_instances WHERE equipment_code='EQI-TY-SHARK-PUMP-01')),
        ($1, $3, (SELECT id FROM equipment_instances WHERE equipment_code='EQI-TY-SHARK-PUMP-02'))
      ON CONFLICT DO NOTHING
    `, [projId, ff1500Id, pump55Id]);

    // Documents
    await client.query(`
      INSERT INTO documents (document_code, document_title, document_type, discipline, project_id, system_id, status, created_by) VALUES
        ('DOC-PID-SHARK-01', 'Shark LSS P&ID - Primary Filtration', 'PID', 'Mechanical', $1, $2, 'Draft', $3),
        ('DOC-CALC-SHARK-01', 'Shark LSS Turnover Calculation', 'Calculation', 'Mechanical', $1, $2, 'Approved', $3),
        ('DOC-SPEC-LSS-001', 'Life Support System Specification', 'Specification', 'Mechanical', $1, NULL, 'Released', $3),
        ('DOC-DRW-TANK-SHARK-01', 'Shark Tank General Arrangement', 'Drawing', 'Structural', $1, NULL, 'Draft', $3)
      ON CONFLICT DO NOTHING
    `, [projId, sys1Id, adminId]);

    // Document Revisions
    const doc1Res = await client.query(`SELECT id FROM documents WHERE document_code='DOC-PID-SHARK-01'`);
    const doc2Res = await client.query(`SELECT id FROM documents WHERE document_code='DOC-CALC-SHARK-01'`);
    const doc3Res = await client.query(`SELECT id FROM documents WHERE document_code='DOC-SPEC-LSS-001'`);

    await client.query(`
      INSERT INTO document_revisions (document_id, revision_code, revision_purpose, status, created_by) VALUES
        ($1, 'A', 'Preliminary Issue for Review', 'Draft', $4),
        ($2, 'A', 'Preliminary', 'Draft', $4),
        ($2, 'B', 'For Approval', 'Approved', $4),
        ($3, 'A', 'For Information', 'Released', $4)
      ON CONFLICT DO NOTHING
    `, [doc1Res.rows[0].id, doc2Res.rows[0].id, doc3Res.rows[0].id, adminId]);

    // Lifecycle transitions
    await client.query(`
      INSERT INTO lifecycle_transitions (entity_type, entity_id, from_state, to_state, actor_id, comment) VALUES
        ('document', $1, NULL, 'Draft', $2, 'Document registered'),
        ('document', $1, 'Draft', 'Review', $2, 'Submitted for internal review'),
        ('document', $1, 'Review', 'Approved', $2, 'Approved by engineering manager')
      ON CONFLICT DO NOTHING
    `, [doc2Res.rows[0].id, adminId]);

    // Graph relationships
    const sharkSysRes = await client.query(`SELECT id FROM systems WHERE project_id=$1 AND system_code='SYS-LSS-SHARK-01'`, [projId]);

    await client.query(`
      INSERT INTO entity_relationships (source_id, source_type, target_id, target_type, edge_type) VALUES
        ($1, 'project', $2, 'area', 'contains'),
        ($1, 'project', $3, 'area', 'contains'),
        ($2, 'area', $4, 'exhibit', 'contains'),
        ($4, 'exhibit', $5, 'system', 'served_by'),
        ($5, 'system', (SELECT id::text FROM equipment_instances WHERE equipment_code='EQI-TY-SHARK-FF-01'), 'equipment', 'contains'),
        ($5, 'system', (SELECT id::text FROM equipment_instances WHERE equipment_code='EQI-TY-SHARK-PUMP-01'), 'equipment', 'contains'),
        ((SELECT id::text FROM equipment_instances WHERE equipment_code='EQI-TY-SHARK-FF-01'), 'equipment', $6, 'product', 'references'),
        ((SELECT id::text FROM equipment_instances WHERE equipment_code='EQI-TY-SHARK-FF-02'), 'equipment', $6, 'product', 'references'),
        ($6, 'product', 'MAT-FRP-VE', 'material', 'uses')
      ON CONFLICT DO NOTHING
    `, [projId, sharkAreaId, tropAreaId, sharkExhId, sharkSysRes.rows[0].id, ff1500Id]);

    // Change Requests
    await client.query(`
      INSERT INTO change_requests (change_code, project_id, title, change_reason, risk_level, status, affected_entities, requested_by) VALUES
        ('CR-TY-001', $1, 'Increase Shark LSS flow rate to 2000 m3/h', 'Updated tank volume calculations require higher turnover', 'Medium', 'Proposed', '["SYS-LSS-SHARK-01","EQI-TY-SHARK-FF-01"]'::jsonb, $2)
      ON CONFLICT DO NOTHING
    `, [projId, engId]);

    // Audit logs
    await client.query(`
      INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details) VALUES
        ('project', $1, 'CREATE', $2, '{"project_code":"PRJ-TY-001"}'::jsonb),
        ('document', $3, 'STATE_TRANSITION', $2, '{"from":"Draft","to":"Approved"}'::jsonb)
      ON CONFLICT DO NOTHING
    `, [projId, adminId, doc2Res.rows[0].id]);

    console.log('Seed complete!');
    console.log('Demo credentials:');
    console.log('  admin@edp.com / admin123');
    console.log('  engineer@edp.com / engineer123');
    console.log('  viewer@edp.com / viewer123');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
