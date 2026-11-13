-- Tez-tez filtrlanadigan ustunlar uchun indekslar (faqat qo‘shimcha, sxema o‘zgarmaydi).
CREATE INDEX IF NOT EXISTS payments_student_paid_at_idx ON payments(student_id, paid_at);
CREATE INDEX IF NOT EXISTS payment_audit_created_at_idx ON payment_audit(created_at);
CREATE INDEX IF NOT EXISTS attendance_group_date_idx ON attendance(group_id, date);
CREATE INDEX IF NOT EXISTS attendance_student_date_idx ON attendance(student_id, date);
CREATE INDEX IF NOT EXISTS homework_teacher_due_idx ON homework(teacher_id, due_at);
CREATE INDEX IF NOT EXISTS homework_due_at_idx ON homework(due_at);
CREATE INDEX IF NOT EXISTS homework_submissions_draft_expiry_idx ON homework_submissions(state, expires_at);
CREATE INDEX IF NOT EXISTS salary_payments_paid_at_idx ON salary_payments(paid_at);
CREATE INDEX IF NOT EXISTS salary_payments_teacher_idx ON salary_payments(teacher_id);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(date);
CREATE INDEX IF NOT EXISTS face_sync_device_employee_idx ON face_sync(device_id, employee_no, version);
CREATE INDEX IF NOT EXISTS face_lesson_closures_date_idx ON face_lesson_closures(date);
