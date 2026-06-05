-- Reset test transactional data (keeps user accounts, profiles, cutoffs, and KPI/eval data)
-- Run this in Supabase SQL Editor to start fresh for testing

DELETE FROM ot_approval_requests;
DELETE FROM daily_time_reports;
DELETE FROM dtr_cutoff_submissions;
DELETE FROM dtr_approval_logs;
DELETE FROM org_nodes;
DELETE FROM leave_requests;
