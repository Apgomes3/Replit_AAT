// Bids: the tender side of enquiries (Business Development). An enquiry is a direct request or a
// formal tender; both move New → Qualifying → Bidding → Submitted → Won / Lost / Closed (the stage
// list itself is in the core schema). This adds the bid/no-bid decision, value, win chance, owner,
// team and why it was lost.
export const BIDS_SCHEMA = `
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS enquiry_type VARCHAR(10) NOT NULL DEFAULT 'direct';
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS estimated_value NUMERIC(14,2);
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS value_currency VARCHAR(3) NOT NULL DEFAULT 'USD';
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS win_probability INTEGER;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS bid_owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS bid_decision VARCHAR(10) NOT NULL DEFAULT 'pending';
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS bid_decided_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS bid_decided_at TIMESTAMPTZ;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS bid_decision_note TEXT;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS submitted_on DATE;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS outcome_reason VARCHAR(30);
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS outcome_note TEXT;
CREATE INDEX IF NOT EXISTS idx_enquiries_bid_owner ON enquiries(bid_owner_user_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_type_check') THEN
    ALTER TABLE enquiries ADD CONSTRAINT enquiries_type_check CHECK (enquiry_type IN ('direct','tender'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_bid_decision_check') THEN
    ALTER TABLE enquiries ADD CONSTRAINT enquiries_bid_decision_check CHECK (bid_decision IN ('pending','bid','no_bid'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_win_probability_check') THEN
    ALTER TABLE enquiries ADD CONSTRAINT enquiries_win_probability_check CHECK (win_probability IS NULL OR win_probability BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_value_check') THEN
    ALTER TABLE enquiries ADD CONSTRAINT enquiries_value_check CHECK ((estimated_value IS NULL OR estimated_value >= 0) AND value_currency ~ '^[A-Z]{3}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_outcome_reason_check') THEN
    ALTER TABLE enquiries ADD CONSTRAINT enquiries_outcome_reason_check CHECK (outcome_reason IS NULL OR outcome_reason IN
      ('price','technical','delivery_time','relationship','scope_changed','client_cancelled','no_decision','no_bid','other'));
  END IF;
END $$;

-- Who works on the bid (the owner leads it).
CREATE TABLE IF NOT EXISTS enquiry_bid_team (
  enquiry_id UUID NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(80),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (enquiry_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_enquiry_bid_team_user ON enquiry_bid_team(user_id);
`;
