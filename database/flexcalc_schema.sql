-- ============================================================
-- FLEXCALC MERGED DATABASE SCHEMA
-- Includes: FlexCalc System + Class Enrollment System
-- Date: January 9, 2026
-- ============================================================

-- ============================================================
-- FLEXCALC DATABASE SCHEMA - UPDATED
-- With Lessons, Materials, and File Upload Support
-- ============================================================

-- Users Table (Student & Educator)
CREATE TABLE users (
    user_id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('student', 'educator') NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL,
    is_active BOOLEAN DEFAULT TRUE,
    INDEX idx_email (email),
    INDEX idx_role (role)
);

-- Student Profiles
CREATE TABLE student_profiles (
    profile_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT UNIQUE NOT NULL,
    grade_level VARCHAR(50),
    school VARCHAR(255),
    baseline_score DECIMAL(5,2),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Educator Profiles
CREATE TABLE educator_profiles (
    profile_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT UNIQUE NOT NULL,
    department VARCHAR(100),
    institution VARCHAR(255),
    verified BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Five Strand Progress Tracking
CREATE TABLE strand_scores (
    score_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    strand_type ENUM('conceptual', 'procedural', 'strategic', 'adaptive', 'productive') NOT NULL,
    current_score DECIMAL(5,2) DEFAULT 0.00,
    max_score DECIMAL(5,2) DEFAULT 100.00,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_strand (user_id, strand_type)
);

-- Module Categories
CREATE TABLE modules (
    module_id INT PRIMARY KEY AUTO_INCREMENT,
    module_name VARCHAR(255) NOT NULL,
    category ENUM('conceptual', 'procedural', 'strategic', 'adaptive') NOT NULL,
    difficulty_level INT DEFAULT 1,
    description TEXT,
    is_gated BOOLEAN DEFAULT FALSE,
    required_conceptual_score DECIMAL(5,2) DEFAULT 0.00,
    icon VARCHAR(50),
    video_url VARCHAR(500),  -- NEW: YouTube video URL
    created_by INT NULL,
    is_custom BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,
    INDEX idx_category (category)
);

-- NEW: Module Lessons
CREATE TABLE module_lessons (
    lesson_id INT PRIMARY KEY AUTO_INCREMENT,
    module_id INT NOT NULL,
    lesson_number INT NOT NULL,
    lesson_title VARCHAR(255) NOT NULL,
    lesson_content LONGTEXT,  -- HTML content
    video_url VARCHAR(500),    -- YouTube video URL
    duration_minutes INT,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (module_id) REFERENCES modules(module_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE KEY unique_module_lesson (module_id, lesson_number),
    INDEX idx_module (module_id)
);

-- NEW: Module Materials (PDF, PPTX, DOCX files)
CREATE TABLE module_materials (
    material_id INT PRIMARY KEY AUTO_INCREMENT,
    module_id INT NOT NULL,
    lesson_id INT NULL,  -- NULL means it's for the whole module
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_type ENUM('pdf', 'pptx', 'docx', 'xlsx', 'other') NOT NULL,
    file_size_kb INT,
    uploaded_by INT NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    download_count INT DEFAULT 0,
    FOREIGN KEY (module_id) REFERENCES modules(module_id) ON DELETE CASCADE,
    FOREIGN KEY (lesson_id) REFERENCES module_lessons(lesson_id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(user_id) ON DELETE CASCADE,
    INDEX idx_module (module_id),
    INDEX idx_lesson (lesson_id)
);

-- Student Module Progress
CREATE TABLE student_progress (
    progress_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    module_id INT NOT NULL,
    status ENUM('locked', 'unlocked', 'in_progress', 'completed') DEFAULT 'locked',
    score DECIMAL(5,2) DEFAULT 0.00,
    attempts INT DEFAULT 0,
    time_spent_seconds INT DEFAULT 0,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (module_id) REFERENCES modules(module_id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_module (user_id, module_id)
);

-- NEW: Student Lesson Progress
CREATE TABLE student_lesson_progress (
    progress_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    lesson_id INT NOT NULL,
    is_completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP NULL,
    time_spent_seconds INT DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (lesson_id) REFERENCES module_lessons(lesson_id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_lesson (user_id, lesson_id)
);

-- Custom Problems (Educator-created)
CREATE TABLE custom_problems (
    problem_id INT PRIMARY KEY AUTO_INCREMENT,
    module_id INT NOT NULL,
    created_by INT NOT NULL,
    question_text TEXT NOT NULL,
    correct_answer VARCHAR(255) NOT NULL,
    explanation TEXT,
    difficulty INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (module_id) REFERENCES modules(module_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Problem Options (for multiple choice)
CREATE TABLE problem_options (
    option_id INT PRIMARY KEY AUTO_INCREMENT,
    problem_id INT NOT NULL,
    option_text VARCHAR(500) NOT NULL,
    is_correct BOOLEAN DEFAULT FALSE,
    option_order INT DEFAULT 1,
    FOREIGN KEY (problem_id) REFERENCES custom_problems(problem_id) ON DELETE CASCADE
);

-- Student Responses
CREATE TABLE student_responses (
    response_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    problem_id INT NOT NULL,
    selected_answer VARCHAR(255),
    is_correct BOOLEAN,
    response_time_seconds INT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (problem_id) REFERENCES custom_problems(problem_id) ON DELETE CASCADE,
    INDEX idx_user_problem (user_id, problem_id)
);

-- Gate Status Tracking
CREATE TABLE gate_status (
    gate_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    gate_name VARCHAR(100) NOT NULL,
    is_unlocked BOOLEAN DEFAULT FALSE,
    unlocked_at TIMESTAMP NULL,
    conceptual_score_at_unlock DECIMAL(5,2),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_gate (user_id, gate_name)
);

-- AI Defense Session Logs
CREATE TABLE ai_defense_logs (
    log_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    module_id INT NOT NULL,
    counter_argument TEXT,
    student_defense TEXT,
    ai_evaluation TEXT,
    defense_score DECIMAL(5,2),
    session_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (module_id) REFERENCES modules(module_id) ON DELETE CASCADE
);

-- Analytics Snapshots (for RÂ² variance tracking)
CREATE TABLE analytics_snapshots (
    snapshot_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    conceptual_score DECIMAL(5,2),
    procedural_score DECIMAL(5,2),
    strategic_score DECIMAL(5,2),
    adaptive_score DECIMAL(5,2),
    productive_score DECIMAL(5,2),
    performance_score DECIMAL(5,2),
    r_squared_value DECIMAL(5,4),
    flexibility_gap DECIMAL(5,2),
    risk_level ENUM('low', 'medium', 'high') DEFAULT 'low',
    snapshot_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    INDEX idx_user_date (user_id, snapshot_date)
);

-- Session Management
CREATE TABLE sessions (
    session_id VARCHAR(255) PRIMARY KEY,
    user_id INT NOT NULL,
    token VARCHAR(500) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    INDEX idx_token (token),
    INDEX idx_expires (expires_at)
);

-- Teacher Access Codes
CREATE TABLE teacher_codes (
    code_id INT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(50) UNIQUE NOT NULL,
    department VARCHAR(100) NOT NULL,
    school_name VARCHAR(200),
    is_used BOOLEAN DEFAULT FALSE,
    used_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP NULL,
    FOREIGN KEY (used_by) REFERENCES users(user_id)
);

-- ============================================================
-- INSERT SAMPLE DATA
-- ============================================================

-- Insert sample teacher codes
INSERT INTO teacher_codes (code, department, school_name) VALUES
('DEPED-MATH-2025', 'Mathematics Department', 'Calamba National Science High School'),
('STEM-CALC-001', 'STEM Department', 'Laguna Science High School'),
('FLEXCALC-DEMO', 'Research Project', 'FlexCalc Platform Demo');

-- Insert sample modules
INSERT INTO modules (module_name, category, difficulty_level, description, icon, is_gated, required_conceptual_score) VALUES
('Limits and Continuity', 'conceptual', 1, 'Understanding the fundamental concepts of limits and continuity in calculus', '∞', FALSE, 0.00),
('Derivatives Basics', 'procedural', 2, 'Learn how to calculate derivatives using various rules and techniques', 'dy/dx', FALSE, 0.00),
('Integration Techniques', 'procedural', 3, 'Master integration methods including substitution and parts', '∫', TRUE, 70.00),
('Applications of Derivatives', 'strategic', 2, 'Apply derivative concepts to solve real-world problems', '📈', TRUE, 70.00),
('Problem Solving Strategies', 'adaptive', 3, 'Develop flexible thinking and problem-solving approaches', '🧩', TRUE, 70.00);

-- Insert sample lessons for Module 1
INSERT INTO module_lessons (module_id, lesson_number, lesson_title, lesson_content, video_url, duration_minutes, created_by) VALUES
(1, 1, 'Introduction to Limits', 
'<h3>What are Limits?</h3><p>A limit is a fundamental concept in calculus...</p>', 
'https://www.youtube.com/watch?v=riXcZT2ICjA', 15, 1),

(1, 2, 'One-Sided Limits', 
'<h3>Left-Hand and Right-Hand Limits</h3><p>Sometimes we need to examine what happens...</p>', 
'https://www.youtube.com/watch?v=kfF40MiS7zA', 12, 1),

(1, 3, 'Continuity', 
'<h3>Continuous Functions</h3><p>A function is continuous at a point if there are no breaks...</p>', 
'https://www.youtube.com/watch?v=P_qEfjPOaUI', 18, 1);

-- ============================================================
-- USEFUL QUERIES
-- ============================================================

-- Get all lessons for a module
-- SELECT * FROM module_lessons WHERE module_id = 1 ORDER BY lesson_number;

-- Get all materials for a module
-- SELECT * FROM module_materials WHERE module_id = 1;

-- Get student progress with lesson completion
-- SELECT 
--     m.module_name,
--     sp.status,
--     sp.score,
--     COUNT(DISTINCT slp.lesson_id) as completed_lessons,
--     (SELECT COUNT(*) FROM module_lessons WHERE module_id = m.module_id) as total_lessons
-- FROM student_progress sp
-- JOIN modules m ON sp.module_id = m.module_id
-- LEFT JOIN student_lesson_progress slp ON sp.user_id = slp.user_id 
--     AND slp.lesson_id IN (SELECT lesson_id FROM module_lessons WHERE module_id = m.module_id)
-- WHERE sp.user_id = ?
-- GROUP BY m.module_id;

-- ============================================================
-- CLASS ENROLLMENT SYSTEM TABLES
-- ============================================================

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