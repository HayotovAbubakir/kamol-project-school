DROP VIEW IF EXISTS monthly_homework_report;

CREATE VIEW monthly_homework_report AS
SELECT
  st.id AS student_id,
  st.name AS student_name,
  date(substr(COALESCE(h.due_at, h.created_at), 1, 7) || '-01') AS month_start,
  COUNT(h.id) AS assigned_count,
  SUM(CASE WHEN hs.submitted_at IS NOT NULL AND (
    h.due_at IS NULL OR julianday(hs.submitted_at) <= julianday(h.due_at)
  ) THEN 1 ELSE 0 END) AS submitted_on_time_count,
  SUM(CASE WHEN hs.submitted_at IS NOT NULL AND h.due_at IS NOT NULL
    AND julianday(hs.submitted_at) > julianday(h.due_at) THEN 1 ELSE 0 END) AS late_count,
  SUM(CASE WHEN hs.student_result = 'not_done'
    OR hs.teacher_result = 'not_done'
    OR (hs.submitted_at IS NULL AND h.due_at IS NOT NULL AND julianday(h.due_at) < julianday('now'))
    THEN 1 ELSE 0 END) AS not_done_count,
  SUM(CASE WHEN hs.teacher_result = 'done' THEN 1 ELSE 0 END) AS bajardi_count,
  SUM(CASE WHEN hs.teacher_result = 'not_done' THEN 1 ELSE 0 END) AS bajarmadi_count
FROM homework h
JOIN group_students gs ON gs.group_id = h.group_id
JOIN students st ON st.id = gs.student_id
LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = st.id
  AND hs.attempt_number = (
    SELECT MAX(latest.attempt_number) FROM homework_submissions latest
    WHERE latest.homework_id = h.id AND latest.student_id = st.id
  )
GROUP BY st.id, st.name, substr(COALESCE(h.due_at, h.created_at), 1, 7);
