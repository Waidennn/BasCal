-- ============================================================
-- CLASS ENROLLMENT SYSTEM - Database Schema
-- ============================================================

-- Classes Table (Teacher creates classes)
CREATE TABLE classes (
    class_id INT PRIMARY KEY AUTO_INCREMENT,
    class_name VARCHAR(100) NOT NULL,
    class_code VARCHAR(20) UNIQUE NOT NULL,
    teacher_id INT NOT NULL,
    grade_level VARCHAR(50),
    section VARCHAR(50),
    school_year VARCHAR(20),
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES users(user_id) ON DELETE CASCADE,
    INDEX idx_class_code (class_code),
    INDEX idx_teacher (teacher_id)
);

-- Class Enrollments (Students join classes)
CREATE TABLE class_enrollments (
    enrollment_id INT PRIMARY KEY AUTO_INCREMENT,
    class_id INT NOT NULL,
    student_id INT NOT NULL,
    enrollment_status ENUM('active', 'dropped', 'completed') DEFAULT 'active',
    enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    dropped_at TIMESTAMP NULL,
    FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE KEY unique_student_class (student_id, class_id),
    INDEX idx_class (class_id),
    INDEX idx_student (student_id)
);

-- Class Announcements
CREATE TABLE class_announcements (
    announcement_id INT PRIMARY KEY AUTO_INCREMENT,
    class_id INT NOT NULL,
    teacher_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES users(user_id) ON DELETE CASCADE,
    INDEX idx_class (class_id)
);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Function to generate unique class code
DELIMITER //
CREATE FUNCTION generate_class_code(teacher_id INT, class_name VARCHAR(100))
RETURNS VARCHAR(20)
DETERMINISTIC
BEGIN
    DECLARE code VARCHAR(20);
    DECLARE teacher_initials VARCHAR(3);
    DECLARE random_suffix VARCHAR(4);
    
    -- Get teacher initials (first letter of first and last name)
    SELECT CONCAT(
        UPPER(LEFT(first_name, 1)),
        UPPER(LEFT(last_name, 1))
    ) INTO teacher_initials
    FROM users
    WHERE user_id = teacher_id;
    
    -- Generate random 4-digit suffix
    SET random_suffix = LPAD(FLOOR(RAND() * 10000), 4, '0');
    
    -- Combine: FC-{initials}-{random}
    SET code = CONCAT('FC-', teacher_initials, '-', random_suffix);
    
    RETURN code;
END //
DELIMITER ;

-- ============================================================
-- USEFUL QUERIES
-- ============================================================

-- Get all students in a class with their progress
/*
SELECT 
    u.user_id,
    u.first_name,
    u.last_name,
    u.email,
    ce.enrolled_at,
    AVG(sp.score) as avg_score,
    COUNT(DISTINCT sp.module_id) as modules_completed
FROM class_enrollments ce
JOIN users u ON ce.student_id = u.user_id
LEFT JOIN student_progress sp ON u.user_id = sp.user_id AND sp.status = 'completed'
WHERE ce.class_id = ? AND ce.enrollment_status = 'active'
GROUP BY u.user_id
ORDER BY u.last_name, u.first_name;
*/

-- Get class analytics
/*
SELECT 
    c.class_name,
    c.class_code,
    COUNT(DISTINCT ce.student_id) as total_students,
    COUNT(DISTINCT CASE WHEN sp.status = 'completed' THEN sp.module_id END) as total_completions,
    AVG(sp.score) as class_average
FROM classes c
LEFT JOIN class_enrollments ce ON c.class_id = ce.class_id AND ce.enrollment_status = 'active'
LEFT JOIN student_progress sp ON ce.student_id = sp.user_id AND sp.status = 'completed'
WHERE c.class_id = ?
GROUP BY c.class_id;
*/

-- Get student's current class
/*
SELECT 
    c.class_id,
    c.class_name,
    c.class_code,
    c.grade_level,
    c.section,
    u.first_name as teacher_first_name,
    u.last_name as teacher_last_name,
    ce.enrolled_at
FROM class_enrollments ce
JOIN classes c ON ce.class_id = c.class_id
JOIN users u ON c.teacher_id = u.user_id
WHERE ce.student_id = ? AND ce.enrollment_status = 'active'
ORDER BY ce.enrolled_at DESC
LIMIT 1;
*/

-- Check if class code exists and is valid
/*
SELECT 
    c.class_id,
    c.class_name,
    c.teacher_id,
    u.first_name as teacher_first_name,
    u.last_name as teacher_last_name,
    c.is_active
FROM classes c
JOIN users u ON c.teacher_id = u.user_id
WHERE c.class_code = ? AND c.is_active = TRUE;
*/

-- Get teacher's classes with student counts
/*
SELECT 
    c.class_id,
    c.class_name,
    c.class_code,
    c.grade_level,
    c.section,
    c.created_at,
    COUNT(DISTINCT ce.student_id) as student_count,
    AVG(sp.score) as class_average
FROM classes c
LEFT JOIN class_enrollments ce ON c.class_id = ce.class_id AND ce.enrollment_status = 'active'
LEFT JOIN student_progress sp ON ce.student_id = sp.user_id AND sp.status = 'completed'
WHERE c.teacher_id = ? AND c.is_active = TRUE
GROUP BY c.class_id
ORDER BY c.created_at DESC;
*/

-- ============================================================
-- SAMPLE DATA
-- ============================================================

-- Insert sample classes
INSERT INTO classes (class_name, class_code, teacher_id, grade_level, section, school_year, description) VALUES
('Basic Calculus - Section A', 'FC-TE-2501', 1, 'Grade 11', 'Section A', '2024-2025', 'Introduction to calculus concepts'),
('Basic Calculus - Section B', 'FC-TE-2502', 1, 'Grade 11', 'Section B', '2024-2025', 'Introduction to calculus concepts'),
('Advanced Calculus', 'FC-TE-2503', 1, 'Grade 12', 'STEM 1', '2024-2025', 'Advanced topics in calculus');

-- ============================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================

-- Index for finding active enrollments
CREATE INDEX idx_enrollment_status ON class_enrollments(enrollment_status, class_id);

-- Index for class analytics queries
CREATE INDEX idx_class_active ON classes(is_active, teacher_id);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Trigger to prevent students from enrolling in multiple active classes (optional)
-- Uncomment if you want students to only be in ONE class at a time
/*
DELIMITER //
CREATE TRIGGER prevent_multiple_enrollments
BEFORE INSERT ON class_enrollments
FOR EACH ROW
BEGIN
    DECLARE existing_count INT;
    
    SELECT COUNT(*) INTO existing_count
    FROM class_enrollments
    WHERE student_id = NEW.student_id 
    AND enrollment_status = 'active';
    
    IF existing_count > 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Student is already enrolled in an active class';
    END IF;
END //
DELIMITER ;
*/
