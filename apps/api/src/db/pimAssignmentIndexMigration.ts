export const pimAssignmentIndexMigration = `
DO $migration$
BEGIN
  IF to_regclass('idx_tanks_pim_assignment') IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM tanks
      WHERE exhibit_id IS NOT NULL AND product_master_id IS NOT NULL
      GROUP BY project_id, exhibit_id, product_master_id
      HAVING COUNT(*) > 1
    ) THEN
      RAISE WARNING 'Skipped idx_tanks_pim_assignment because legacy duplicate PIM exhibit assignments exist. Resolve duplicates, then rerun migrations to enable database-level enforcement.';
    ELSE
      CREATE UNIQUE INDEX idx_tanks_pim_assignment
        ON tanks(project_id, exhibit_id, product_master_id)
        WHERE exhibit_id IS NOT NULL AND product_master_id IS NOT NULL;
    END IF;
  END IF;
END
$migration$;
`;