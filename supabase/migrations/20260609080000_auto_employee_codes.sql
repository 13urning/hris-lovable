-- Auto-generate employee codes for existing employees that don't have one
-- Format: EMP-001, EMP-002, etc., ordered by account creation date

DO $$
DECLARE
  rec RECORD;
  counter INT := 0;
BEGIN
  -- Find the current max numeric suffix so we don't collide with existing codes
  SELECT COALESCE(
    MAX(CAST(REGEXP_REPLACE(employee_code, '[^0-9]', '', 'g') AS INT)), 0
  )
  INTO counter
  FROM profiles
  WHERE employee_code ~ '^EMP-[0-9]+$';

  FOR rec IN
    SELECT id FROM profiles
    WHERE employee_code IS NULL OR employee_code = ''
    ORDER BY created_at
  LOOP
    counter := counter + 1;
    UPDATE profiles
    SET employee_code = 'EMP-' || LPAD(counter::text, 3, '0')
    WHERE id = rec.id;
  END LOOP;
END $$;

-- Function: auto-assign next EMP-XXX code on insert if none supplied
CREATE OR REPLACE FUNCTION auto_generate_employee_code()
RETURNS TRIGGER AS $$
DECLARE
  next_num INT;
BEGIN
  IF NEW.employee_code IS NULL OR NEW.employee_code = '' THEN
    SELECT COALESCE(
      MAX(CAST(REGEXP_REPLACE(employee_code, '[^0-9]', '', 'g') AS INT)), 0
    ) + 1
    INTO next_num
    FROM profiles
    WHERE employee_code ~ '^EMP-[0-9]+$';

    NEW.employee_code := 'EMP-' || LPAD(next_num::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: fires before each INSERT on profiles
DROP TRIGGER IF EXISTS trigger_auto_employee_code ON profiles;
CREATE TRIGGER trigger_auto_employee_code
  BEFORE INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_employee_code();
