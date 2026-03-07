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
        ('PFM-FF', 'Foam Fractionators', 'FILTRATION', 'Active'),
        ('PFM-PUMP', 'Circulation Pumps', 'PUMPING', 'Active'),
        ('PFM-DRUM', 'Drum Filters', 'FILTRATION', 'Active'),
        ('PFM-UV', 'UV Sterilizers', 'DISINFECTION', 'Active'),
        ('PFM-HX', 'Heat Exchangers', 'THERMAL', 'Active'),
        ('PFM-OZ', 'Ozone Generators', 'DISINFECTION', 'Active')
      ON CONFLICT (product_family_code) DO NOTHING
    `);

    const ffFamilyRes = await client.query(`SELECT id FROM product_families WHERE product_family_code = 'PFM-FF'`);
    const pumpFamilyRes = await client.query(`SELECT id FROM product_families WHERE product_family_code = 'PFM-PUMP'`);
    const drumFamilyRes = await client.query(`SELECT id FROM product_families WHERE product_family_code = 'PFM-DRUM'`);
    const uvFamilyRes = await client.query(`SELECT id FROM product_families WHERE product_family_code = 'PFM-UV'`);

    // Product Masters
    await client.query(`
      INSERT INTO product_masters (product_code, product_family_id, product_name, product_category, application_type, design_flow_m3h, power_kw, primary_material_code, standard_status) VALUES
        ('PM-FF-1500', $1, 'Foam Fractionator FF-1500', 'Filtration', 'Marine Display', 1500, 7.5, 'MAT-FRP-VE', 'Active'),
        ('PM-FF-800', $1, 'Foam Fractionator FF-800', 'Filtration', 'Marine Display', 800, 4.0, 'MAT-FRP-VE', 'Active'),
        ('PM-PUMP-CIR-55', $2, 'Circulation Pump 55kW', 'Pumping', 'LSS Primary', 1200, 55.0, 'MAT-SS316', 'Active'),
        ('PM-PUMP-CIR-22', $2, 'Circulation Pump 22kW', 'Pumping', 'LSS Primary', 500, 22.0, 'MAT-SS316', 'Active'),
        ('PM-DRUM-60', $3, 'Drum Filter 60Hz', 'Filtration', 'Mechanical Filtration', 800, 1.5, 'MAT-SS316', 'Active'),
        ('PM-UV-120', $4, 'UV Sterilizer 120W/m3', 'Disinfection', 'UV Disinfection', 200, 3.0, 'MAT-SS316', 'Active')
      ON CONFLICT (product_code) DO NOTHING
    `, [ffFamilyRes.rows[0].id, pumpFamilyRes.rows[0].id, drumFamilyRes.rows[0].id, uvFamilyRes.rows[0].id]);

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
      INSERT INTO standard_boms (bom_code, product_master_id, revision_code) VALUES
        ('BOM-FF-1500-A', (SELECT id FROM product_masters WHERE product_code='PM-FF-1500'), 'A'),
        ('BOM-PUMP-55-A', (SELECT id FROM product_masters WHERE product_code='PM-PUMP-CIR-55'), 'A')
      ON CONFLICT DO NOTHING
    `);

    await client.query(`
      INSERT INTO bom_lines (standard_bom_id, line_number, component_type, component_reference_code, component_name, quantity, unit) VALUES
        ((SELECT id FROM standard_boms WHERE bom_code='BOM-FF-1500-A'), 1, 'Vessel', 'FRP-VE-VESSEL-1500', 'FRP-VE Reaction Column', 1, 'EA'),
        ((SELECT id FROM standard_boms WHERE bom_code='BOM-FF-1500-A'), 2, 'Pump', 'PM-PUMP-CIR-22', 'Air Blower Pump', 2, 'EA'),
        ((SELECT id FROM standard_boms WHERE bom_code='BOM-FF-1500-A'), 3, 'Instrument', 'INS-FLOW-001', 'Flow Meter', 1, 'EA'),
        ((SELECT id FROM standard_boms WHERE bom_code='BOM-FF-1500-A'), 4, 'Valve', 'VLV-BALL-50', 'Ball Valve DN50', 4, 'EA')
      ON CONFLICT DO NOTHING
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
