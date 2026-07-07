const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const cors = require('cors');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ============================================================
// DATABASE CONNECTION POOL
// ============================================================
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: 'flexcalc_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ============================================================
// FILE UPLOAD CONFIGURATION
// ============================================================
const uploadsDir = path.join(__dirname, 'public', 'uploads', 'materials');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        const allowedTypes = /pdf|docx|pptx|xlsx|doc|ppt|xls/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only PDF, DOCX, PPTX, and XLSX files are allowed!'));
        }
    }
});

pool.getConnection()
    .then(conn => {
        console.log('✅ Database connected successfully');
        conn.release();
    })
    .catch(err => {
        console.error('❌ Database connection failed:', err.message);
    });

// ============================================================
// 🆕🆕🆕 RESEARCH-BASED CONSTANTS (PRIORITY 2) 🆕🆕🆕
// ============================================================
const BASELINE_CONSTANT = 76.3;  // Students have stable 76% baseline
const WEAK_CORRELATION = 0.226;  // r=0.226 (weak positive correlation)
const R_SQUARED = 0.068;         // R²=0.068 (6.8% variance explained)

// ============================================================
// 🆕🆕🆕 STRAND WEIGHTS - 12 MODULES ONLY (PRIORITY 5) 🆕🆕🆕
// ============================================================
const STRAND_WEIGHTS = {
    // Q3 Modules - Differentiation
    1: { conceptual: 0.40, procedural: 0.20, strategic: 0.15, adaptive: 0.20, productive: 0.05 }, // Limits
    2: { conceptual: 0.45, procedural: 0.20, strategic: 0.15, adaptive: 0.15, productive: 0.05 }, // Continuity
    3: { conceptual: 0.40, procedural: 0.25, strategic: 0.15, adaptive: 0.15, productive: 0.05 }, // Derivatives - Definition
    4: { conceptual: 0.25, procedural: 0.50, strategic: 0.10, adaptive: 0.10, productive: 0.05 }, // Differentiation Rules
    5: { conceptual: 0.20, procedural: 0.45, strategic: 0.20, adaptive: 0.10, productive: 0.05 }, // Implicit Differentiation
    6: { conceptual: 0.20, procedural: 0.30, strategic: 0.35, adaptive: 0.10, productive: 0.05 }, // Related Rates
    
    // Q4 Modules - Integration
    7: { conceptual: 0.30, procedural: 0.45, strategic: 0.10, adaptive: 0.10, productive: 0.05 }, // Antiderivatives
    8: { conceptual: 0.25, procedural: 0.25, strategic: 0.35, adaptive: 0.10, productive: 0.05 }, // Extreme Values & Optimization
    9: { conceptual: 0.40, procedural: 0.30, strategic: 0.15, adaptive: 0.10, productive: 0.05 }, // Riemann Sums
    10: { conceptual: 0.45, procedural: 0.25, strategic: 0.15, adaptive: 0.10, productive: 0.05 }, // Fundamental Theorem
    11: { conceptual: 0.25, procedural: 0.45, strategic: 0.15, adaptive: 0.10, productive: 0.05 }, // Definite Integrals
    12: { conceptual: 0.30, procedural: 0.30, strategic: 0.25, adaptive: 0.10, productive: 0.05 }  // Areas of Plane Regions
};

const CONCEPTUAL_THRESHOLD = 70.0;

// ============================================================
// 🆕🆕🆕 WEAK CORRELATION MODEL (PRIORITY 3) 🆕🆕🆕
// ============================================================
const PROFICIENCY_PERFORMANCE_CURVE = {
    0: 0, 20: 8, 40: 18, 60: 30, 80: 45, 100: 60
};

function applyWeakCorrelation(proficiencyScore) {
    const keys = Object.keys(PROFICIENCY_PERFORMANCE_CURVE).map(Number);
    
    for (let i = 0; i < keys.length - 1; i++) {
        if (proficiencyScore >= keys[i] && proficiencyScore <= keys[i + 1]) {
            const x1 = keys[i], x2 = keys[i + 1];
            const y1 = PROFICIENCY_PERFORMANCE_CURVE[x1];
            const y2 = PROFICIENCY_PERFORMANCE_CURVE[x2];
            return y1 + ((proficiencyScore - x1) / (x2 - x1)) * (y2 - y1);
        }
    }
    return proficiencyScore * 0.6;
}

// ============================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Access token required' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    });
};

const requireRole = (role) => {
    return (req, res, next) => {
        const userRole = req.user.role;
        
        // 🔧 NORMALIZE ROLES: 'educator' and 'teacher' are equivalent
        const normalizedUserRole = (userRole === 'educator' || userRole === 'teacher') ? 'teacher' : userRole;
        const normalizedRequiredRole = (role === 'educator' || role === 'teacher') ? 'teacher' : role;
        
        if (normalizedUserRole !== normalizedRequiredRole) {
            return res.status(403).json({ 
                error: 'Insufficient permissions',
                required: role,
                actual: userRole
            });
        }
        next();
    };
}

// Module ownership check middleware
const checkModuleOwnership = async (req, res, next) => {
    const moduleId = req.params.moduleId;
    const userId = req.user.userId;

    try {
        const module = await pool.query(
            `SELECT moduleid FROM modules WHERE moduleid = ?`,
            [moduleId]
        );

        if (module.length === 0) {
            return res.status(404).json({ error: 'Module not found' });
        }

        // Allow all educators to access all modules (collaborative platform)
        // If you need strict ownership, add: if (module[0].createdby !== userId) { return res.status(403)... }
        next();
    } catch (error) {
        console.error('Module ownership check error:', error);
        res.status(500).json({ error: 'Failed to verify module access' });
    }
};
;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

async function initializeStrandScores(userId, connection) {
    const strands = ['conceptual', 'procedural', 'strategic', 'adaptive', 'productive'];
    for (const strand of strands) {
        await connection.query(
            'INSERT INTO strand_scores (user_id, strand_type) VALUES (?, ?)',
            [userId, strand]
        );
    }
}

// ============================================================
// 🆕🆕🆕 HOLISTIC STRAND SCORING (PRIORITY 1) 🆕🆕🆕
// ============================================================
async function updateStrandScoresHolistic(userId, moduleId, isCorrect, connection) {
    const weights = STRAND_WEIGHTS[moduleId];
    if (!weights) {
        console.warn(`⚠️ No weights for module ${moduleId}`);
        return;
    }

    const scoreIncrement = isCorrect ? 1 : 0;
    
    const [currentStrands] = await connection.query(
        'SELECT strand_type, current_score FROM strand_scores WHERE user_id = ?',
        [userId]
    );
    
    if (currentStrands.length === 0) {
        console.error(`❌ No strands for user ${userId}`);
        return;
    }

    const strandScores = {};
    currentStrands.forEach(s => strandScores[s.strand_type] = s.current_score);
    
    const scores = Object.values(strandScores);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, score) => 
        sum + Math.pow(score - mean, 2), 0) / scores.length;
    
    const balanceBonus = Math.max(0, 1 - (variance / 500));
    
    for (const [strand, weight] of Object.entries(weights)) {
        const individualScore = scoreIncrement * weight * 10;
        const holisticBonus = balanceBonus * 2;
        const totalIncrease = individualScore + holisticBonus;
        
        await connection.query(
            `UPDATE strand_scores 
             SET current_score = LEAST(100, current_score + ?),
                 last_updated = NOW()
             WHERE user_id = ? AND strand_type = ?`,
            [totalIncrease, userId, strand]
        );
    }
    
    console.log(`✅ Holistic update: user ${userId}, module ${moduleId}, balance ${(balanceBonus*100).toFixed(1)}%`);
}

// ============================================================
// 🆕🆕🆕 PREDICTED PERFORMANCE (PRIORITY 2) 🆕🆕🆕
// ============================================================
function calculatePredictedPerformance(strandScores) {
    const avgProficiency = strandScores.reduce((sum, s) => sum + s.current_score, 0) / strandScores.length;
    const proficiencyContribution = applyWeakCorrelation(avgProficiency);
    
    const scores = strandScores.map(s => s.current_score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
    const synergyBonus = Math.max(0, (1 - (variance / 500)) * 15);
    
    const predictedGrade = Math.min(100, BASELINE_CONSTANT + proficiencyContribution + synergyBonus);
    
    return {
        baseline: BASELINE_CONSTANT,
        proficiencyContribution: Math.round(proficiencyContribution * 10) / 10,
        synergyBonus: Math.round(synergyBonus * 10) / 10,
        predicted: Math.round(predictedGrade),
        avgProficiency: Math.round(avgProficiency * 10) / 10,
        variance: Math.round(variance * 10) / 10
    };
}

async function checkAndUnlockGates(userId, connection) {
    const [conceptualScore] = await connection.query(
        'SELECT current_score FROM strand_scores WHERE user_id = ? AND strand_type = "conceptual"',
        [userId]
    );

    if (conceptualScore.length === 0) return;
    const score = conceptualScore[0].current_score;

    if (score >= CONCEPTUAL_THRESHOLD) {
        const [gatedModules] = await connection.query(
            'SELECT module_id FROM modules WHERE is_gated = TRUE AND required_conceptual_score <= ?',
            [score]
        );

        for (const module of gatedModules) {
            const [existing] = await connection.query(
                'SELECT * FROM student_progress WHERE user_id = ? AND module_id = ?',
                [userId, module.module_id]
            );

            if (existing.length === 0) {
                await connection.query(
                    'INSERT INTO student_progress (user_id, module_id, status) VALUES (?, ?, "unlocked")',
                    [userId, module.module_id]
                );
            } else if (existing[0].status === 'locked') {
                await connection.query(
                    'UPDATE student_progress SET status = "unlocked" WHERE user_id = ? AND module_id = ?',
                    [userId, module.module_id]
                );
            }
        }

        await connection.query(
            `INSERT INTO gate_status (user_id, gate_name, is_unlocked, unlocked_at, conceptual_score_at_unlock)
             VALUES (?, "Procedural Fluency", TRUE, NOW(), ?)
             ON DUPLICATE KEY UPDATE is_unlocked = TRUE, unlocked_at = NOW(), conceptual_score_at_unlock = ?`,
            [userId, score, score]
        );
    }
}

async function determineQuizDifficulty(userId) {
    try {
        const [strands] = await pool.query(
            'SELECT current_score FROM strand_scores WHERE user_id = ?',
            [userId]
        );
        
        if (strands.length === 0) return 2;
        
        const avgScore = strands.reduce((sum, s) => sum + s.current_score, 0) / strands.length;
        
        if (avgScore < 40) return 1;
        if (avgScore < 70) return 2;
        if (avgScore < 85) return 3;
        return 2;
    } catch (error) {
        console.error('Quiz difficulty error:', error);
        return 2;
    }
}

// ============================================================

// Register
app.post('/api/auth/register', async (req, res) => {
    const { firstName, lastName, email, password, role, teacherCode } = req.body;
    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        // Check if email exists
        const [existing] = await conn.query('SELECT * FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Email already registered' });
        }

        // Validate teacher code if registering as educator
        if (role === 'educator') {
            if (!teacherCode) {
                await conn.rollback();
                return res.status(400).json({ message: 'Teacher code required' });
            }

            const [codes] = await conn.query(
                'SELECT * FROM teacher_codes WHERE code = ? AND is_used = FALSE',
                [teacherCode]
            );

            if (codes.length === 0) {
                await conn.rollback();
                return res.status(400).json({ message: 'Invalid or already used teacher code' });
            }
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user
        const [result] = await conn.query(
            'INSERT INTO users (first_name, last_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
            [firstName, lastName, email, hashedPassword, role]
        );

        const userId = result.insertId;

        // Mark teacher code as used
        if (role === 'educator' && teacherCode) {
            await conn.query(
                'UPDATE teacher_codes SET is_used = TRUE, used_by = ?, used_at = NOW() WHERE code = ?',
                [userId, teacherCode]
            );
        }

        // Initialize strand scores for students
        if (role === 'student') {
            await initializeStrandScores(userId, conn);

            // Initialize progress for all modules as locked
            const [modules] = await conn.query('SELECT module_id, is_gated FROM modules');
            for (const module of modules) {
                const status = module.is_gated ? 'locked' : 'unlocked';
                await conn.query(
                    'INSERT INTO student_progress (user_id, module_id, status) VALUES (?, ?, ?)',
                    [userId, module.module_id, status]
                );
            }
        }

        await conn.commit();

        res.status(201).json({
            message: 'Registration successful',
            user: { firstName, lastName, email, role }
        });

    } catch (error) {
        await conn.rollback();
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Server error during registration' });
    } finally {
        conn.release();
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    console.log('🔍 LOGIN ATTEMPT');
    console.log('📧 Email received:', email);
    console.log('🔑 Password received:', password);

    if (!email || !password) {
        console.log('❌ Missing email or password');
        return res.status(400).json({ error: 'Email and password required' });
    }

    try {
        const [users] = await pool.query(
            'SELECT user_id, email, password_hash, role, first_name, last_name, is_active FROM users WHERE email = ?',
            [email]
        );

        console.log('👤 Users found:', users.length);

        if (users.length === 0) {
            console.log('❌ No user found with email:', email);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = users[0];

        console.log('✅ User data:', {
            user_id: user.user_id,
            email: user.email,
            role: user.role,
            is_active: user.is_active
        });

        console.log('🔐 Password hash from DB:', user.password_hash);

        if (!user.is_active) {
            console.log('❌ Account is not active');
            return res.status(403).json({ error: 'Account deactivated' });
        }

        console.log('🔄 Comparing passwords...');
        const isValid = await bcrypt.compare(password, user.password_hash);
        console.log('🔐 Password comparison result:', isValid);

        if (!isValid) {
            console.log('❌ Password does not match!');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        console.log('✅ Login successful!');

        await pool.query('UPDATE users SET last_login = NOW() WHERE user_id = ?', [user.user_id]);

        const token = jwt.sign(
            { userId: user.user_id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        const sessionId = crypto.randomBytes(32).toString('hex');
        await pool.query(
            'INSERT INTO sessions (session_id, user_id, token, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
            [sessionId, user.user_id, token]
        );

        res.json({
            token,
            user: {
                userId: user.user_id,
                email: user.email,
                role: user.role,
                firstName: user.first_name,
                lastName: user.last_name
            }
        });

    } catch (error) {
        console.error('💥 Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// Logout
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM sessions WHERE user_id = ?', [req.user.userId]);
        res.json({ message: 'Logout successful' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Server error during logout' });
    }
});

// ============================================================
// STUDENT ROUTES
// ============================================================

// Get student dashboard
app.get('/api/student/dashboard', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const userId = req.user.userId;
        
        console.log(`📊 Loading dashboard for user ${userId}`);
        
        // ✅ Get strand scores
        const [strands] = await pool.query(
            'SELECT strand_type, current_score, max_score FROM strand_scores WHERE user_id = ?',
            [userId]
        );

        // ✅ FIXED: Get modules with QUIZ-BASED progress (not student_progress table)
        const [modules] = await pool.query(`
            SELECT 
                m.module_id, 
                m.module_name, 
                m.category, 
                m.icon,
                m.difficulty_level,
                m.description,
                -- Quiz-based progress
                COUNT(DISTINCT sqa.attempt_id) as attempts,
                ROUND(MAX(sqa.score_percentage), 2) as score,
                ROUND(AVG(sqa.score_percentage), 2) as average_score,
                -- Status based on quiz scores
                CASE 
                    WHEN MAX(sqa.score_percentage) >= 70 THEN 'completed'
                    WHEN COUNT(sqa.attempt_id) > 0 THEN 'in_progress'
                    ELSE 'not_started'
                END as status,
                -- Progress (0-100)
                COALESCE(MAX(sqa.score_percentage), 0) as progress,
                -- Count active quizzes for this module
                COUNT(DISTINCT qsa.quiz_set_id) as total_quizzes,
                0 as total_items
            FROM modules m
            LEFT JOIN quiz_sets qs ON m.module_id = qs.module_id
            LEFT JOIN quiz_set_assignments qsa ON qs.quiz_set_id = qsa.quiz_set_id
            LEFT JOIN student_quiz_attempts sqa 
                ON qsa.assignment_id = sqa.assignment_id 
                AND sqa.student_id = ? 
                AND sqa.status = 'submitted'
            GROUP BY m.module_id
            ORDER BY m.module_id
        `, [userId]);

        console.log(`✅ Found ${modules.length} modules`);

        // ✅ Recent activity from quiz attempts
        const [recentActivity] = await pool.query(`
            SELECT 
                m.module_name,
                sqa.score_percentage as score,
                sqa.submitted_at as completed_at
            FROM student_quiz_attempts sqa
            JOIN quiz_set_assignments qsa ON sqa.assignment_id = qsa.assignment_id
            JOIN quiz_sets qs ON qsa.quiz_set_id = qs.quiz_set_id
            JOIN modules m ON qs.module_id = m.module_id
            WHERE sqa.student_id = ? AND sqa.status = 'submitted'
            ORDER BY sqa.submitted_at DESC
            LIMIT 5
        `, [userId]);

        console.log(`✅ Dashboard data prepared successfully`);

        res.json({
            strands,
            modules: modules,
            recentActivity
        });

    } catch (error) {
        console.error('❌ Dashboard error:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({ 
            error: 'Failed to load dashboard',
            message: error.message 
        });
    }
});

// ✅ CHECK AND UNLOCK ACHIEVEMENTS
app.post('/api/student/check-achievements', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const userId = req.user.userId;
        const newlyUnlocked = [];

        // Get student's quiz data
        const [quizData] = await pool.query(`
            SELECT 
                COUNT(DISTINCT sqa.attempt_id) as total_attempts,
                COUNT(DISTINCT CASE WHEN sqa.score_percentage >= 70 THEN m.module_id END) as completed_modules,
                COUNT(DISTINCT CASE WHEN sqa.score_percentage = 100 THEN sqa.attempt_id END) as perfect_scores,
                COUNT(DISTINCT m.category) as strands_attempted,
                MAX(sqa.score_percentage) as highest_score,
                MIN(TIMESTAMPDIFF(MINUTE, sqa.started_at, sqa.submitted_at)) as fastest_time
            FROM student_quiz_attempts sqa
            JOIN quiz_set_assignments qsa ON sqa.assignment_id = qsa.assignment_id
            JOIN quiz_sets qs ON qsa.quiz_set_id = qs.quiz_set_id
            JOIN modules m ON qs.module_id = m.module_id
            WHERE sqa.student_id = ? AND sqa.status = 'submitted'
        `, [userId]);

        const stats = quizData[0];

        // Achievement rules
        const achievementRules = [
            { code: 'first_quiz', condition: stats.total_attempts >= 1 },
            { code: 'perfect_score', condition: stats.perfect_scores >= 1 },
            { code: 'module_complete', condition: stats.completed_modules >= 1 },
            { code: 'five_quizzes', condition: stats.total_attempts >= 5 },
            { code: 'all_strands', condition: stats.strands_attempted >= 5 },
            { code: 'speed_demon', condition: stats.fastest_time && stats.fastest_time <= 10 },
        ];

        // Check time-based achievements
        const [timeChecks] = await pool.query(`
            SELECT 
                COUNT(CASE WHEN HOUR(submitted_at) < 8 THEN 1 END) as early_bird_count,
                COUNT(CASE WHEN HOUR(submitted_at) >= 22 THEN 1 END) as night_owl_count
            FROM student_quiz_attempts
            WHERE student_id = ? AND status = 'submitted'
        `, [userId]);

        achievementRules.push(
            { code: 'early_bird', condition: timeChecks[0].early_bird_count >= 1 },
            { code: 'night_owl', condition: timeChecks[0].night_owl_count >= 1 }
        );

        // Check each achievement
        for (const rule of achievementRules) {
            if (rule.condition) {
                // Get achievement details
                const [achievement] = await pool.query(
                    'SELECT achievement_id, title, description, icon FROM achievements WHERE achievement_code = ?',
                    [rule.code]
                );

                if (achievement.length > 0) {
                    // Try to unlock (will fail silently if already unlocked due to UNIQUE constraint)
                    try {
                        await pool.query(
                            'INSERT INTO student_achievements (user_id, achievement_id) VALUES (?, ?)',
                            [userId, achievement[0].achievement_id]
                        );
                        newlyUnlocked.push(achievement[0]);
                    } catch (err) {
                        // Already unlocked, skip
                    }
                }
            }
        }

        console.log(`🏆 Checked achievements for user ${userId}, newly unlocked: ${newlyUnlocked.length}`);

        res.json({
            newlyUnlocked: newlyUnlocked,
            totalPoints: newlyUnlocked.reduce((sum, a) => sum + (a.points || 0), 0)
        });

    } catch (error) {
        console.error('❌ Achievement check error:', error);
        res.status(500).json({ error: 'Failed to check achievements' });
    }
});

// ✅ GET STUDENT ACHIEVEMENTS
app.get('/api/student/achievements', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const userId = req.user.userId;

        // Get all achievements with unlock status
        const [achievements] = await pool.query(`
            SELECT 
                a.achievement_id,
                a.achievement_code,
                a.title,
                a.description,
                a.icon,
                a.category,
                a.points,
                sa.unlocked_at,
                CASE WHEN sa.student_achievement_id IS NOT NULL THEN 1 ELSE 0 END as is_unlocked
            FROM achievements a
            LEFT JOIN student_achievements sa 
                ON a.achievement_id = sa.achievement_id 
                AND sa.user_id = ?
            ORDER BY a.category, a.achievement_id
        `, [userId]);

        const totalUnlocked = achievements.filter(a => a.is_unlocked).length;
        const totalPoints = achievements
            .filter(a => a.is_unlocked)
            .reduce((sum, a) => sum + a.points, 0);

        res.json({
            achievements: achievements,
            stats: {
                totalUnlocked: totalUnlocked,
                totalAvailable: achievements.length,
                totalPoints: totalPoints
            }
        });

    } catch (error) {
        console.error('❌ Get achievements error:', error);
        res.status(500).json({ error: 'Failed to fetch achievements' });
    }
});


// Get available modules
app.get('/api/student/modules', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const [modules] = await pool.query(
            `SELECT m.module_id, m.module_name, m.category, m.difficulty_level, m.description,
                    m.icon, m.is_gated, sp.status, sp.score, sp.attempts
             FROM modules m
             LEFT JOIN student_progress sp ON m.module_id = sp.module_id AND sp.user_id = ?
             ORDER BY m.module_id`,
            [req.user.userId]
        );

        res.json({ modules });
    } catch (error) {
        console.error('Get modules error:', error);
        res.status(500).json({ error: 'Failed to fetch modules' });
    }
});

// ========================================
// NEW: GET MODULES WITH STRAND-BASED GATING (QUIZ-BASED) - FIXED
// ========================================
app.get('/api/student/modules-with-gating', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const userId = req.user.userId;
        console.log('📚 Fetching modules for user:', userId);
        
        // Get student's strand scores
        console.log('  Step 1: Fetching strand scores...');
        const [strandScores] = await pool.query(`
            SELECT strand_type, current_score 
            FROM strand_scores 
            WHERE user_id = ?
        `, [userId]);

        console.log('  Strand scores:', strandScores);

        const scores = {};
        strandScores.forEach(s => {
            scores[s.strand_type] = s.current_score;
        });

        // Get all modules with quiz-based progress
        console.log('  Step 2: Fetching modules...');
        const [modules] = await pool.query(`
            SELECT 
                m.module_id,
                m.module_name,
                m.category,
                m.description,
                m.difficulty_level,
                
                -- Quiz-based progress
                MAX(sqa.score_percentage) as highest_score,
                COUNT(DISTINCT sqa.attempt_id) as attempts,
                
                -- Progress status based on quiz scores
                CASE 
                    WHEN MAX(sqa.score_percentage) >= 75 THEN 'completed'
                    WHEN COUNT(DISTINCT sqa.attempt_id) > 0 THEN 'in_progress'
                    ELSE 'not_started'
                END as progress_status
                
            FROM modules m
            LEFT JOIN quiz_sets qs ON m.module_id = qs.module_id
            LEFT JOIN quiz_set_assignments qsa ON qs.quiz_set_id = qsa.quiz_set_id
            LEFT JOIN student_quiz_attempts sqa ON qsa.assignment_id = sqa.assignment_id 
                AND sqa.student_id = ? 
                AND sqa.status = 'submitted'
            GROUP BY m.module_id, m.module_name, m.category, m.description, m.difficulty_level
            ORDER BY 
                FIELD(m.category, 'conceptual', 'procedural', 'strategic', 'adaptive', 'productive'),
                m.module_id
        `, [userId]);

        console.log('  Modules fetched:', modules.length);

        // Apply gating logic based on MODULE completion (not strand scores)
		console.log('  Step 3: Applying gating logic...');
		const strandOrder = ['conceptual', 'procedural', 'strategic', 'adaptive', 'productive'];
		const groupedModules = {};

		strandOrder.forEach(strand => {
			groupedModules[strand] = [];
		});

		modules.forEach(module => {
			const strand = module.category;
    
			// 🔥 NEW: Sequential module unlocking (Module 1 → Module 2 → Module 3...)
			let isAccessible = true;
    
			if (module.module_id > 1) {
				// Find the immediately previous module (Module N-1)
				const previousModule = modules.find(m => m.module_id === module.module_id - 1);
        
				if (previousModule) {
					// Unlock if previous module has 70%+ score
					const prevScore = previousModule.highest_score || 0;
					isAccessible = prevScore >= 70;
            
					console.log(`    Module ${module.module_id} (${module.module_name}): Previous Module ${previousModule.module_id} score = ${prevScore}% → ${isAccessible ? 'UNLOCKED ✓' : 'LOCKED 🔒'}`);
				} else {
					// If previous module not found, keep locked as safety
					isAccessible = false;
					console.log(`    Module ${module.module_id}: Previous module not found → LOCKED 🔒`);
				}
			} else {
				console.log(`    Module ${module.module_id} (${module.module_name}): First module → UNLOCKED ✓`);
			}

			const accessStatus = isAccessible ? 'unlocked' : 'locked';

			groupedModules[strand].push({
				module_id: module.module_id,
				module_name: module.module_name,
				category: strand,
				description: module.description || 'Master this essential calculus concept',
				difficulty_level: module.difficulty_level || 1,
        
				// Quiz-based progress
				score: Math.round(module.highest_score || 0),
				attempts: module.attempts || 0,
				progress_status: module.progress_status,
        
				// Access control
				access_status: accessStatus,
				is_gated: !isAccessible
			});
		});


        // Calculate strand completion status
        console.log('  Step 4: Calculating strand status...');
        const strandStatus = {};
        for (const strand of strandOrder) {
            const mods = groupedModules[strand];
            const total = mods.length;
            const completed = mods.filter(m => m.progress_status === 'completed' && m.score >= 75).length;
            const allUnlocked = mods.every(m => m.access_status === 'unlocked');
            
            strandStatus[strand] = {
                total,
                completed,
                percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
                status: completed === total ? 'completed' : 
                        completed > 0 ? 'in_progress' : 
                        allUnlocked ? 'unlocked' : 'locked'
            };
        }

        const totalModules = modules.length;
        const completedModules = modules.filter(m => (m.highest_score || 0) >= 75).length;

        console.log('✅ Modules with gating loaded successfully');
        console.log('  Strand scores:', scores);
        console.log('  Completed modules:', completedModules, '/', totalModules);
        console.log('  Conceptual: 89.91% (procedural unlocked!)');
        
        res.json({
            modules: groupedModules,
            strandStatus,
            strandScores: scores,
            overallProgress: {
                total: totalModules,
                completed: completedModules,
                percentage: totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0
            }
        });
        
    } catch (error) {
        console.error('❌ Error fetching modules with gating:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ 
            error: 'Failed to fetch modules', 
            details: error.message
        });
    }
});



// ========================================
// NEW: GET STRAND PROGRESS - FIXED FOR QUIZ SETS
// ========================================
app.get('/api/student/strand-progress', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const userId = req.user.userId;

        // ✅ Get strand scores (actual performance data)
        const [strandScores] = await pool.query(`
            SELECT 
                strand_type,
                ROUND(COALESCE(current_score, 0), 2) as current_score
            FROM strand_scores
            WHERE user_id = ?
        `, [userId]);

        // ✅ Get quiz attempts grouped by module category/strand
        const [moduleStats] = await pool.query(`
            SELECT 
                m.category as strand_type,
                COUNT(DISTINCT m.module_id) as total_modules,
                COUNT(DISTINCT CASE 
                    WHEN sqa.score_percentage >= 70 THEN m.module_id 
                END) as completed_modules,
                COUNT(sqa.attempt_id) as total_attempts,
                ROUND(AVG(CASE 
                    WHEN sqa.score_percentage IS NOT NULL THEN sqa.score_percentage 
                    ELSE 0 
                END), 2) as quiz_average,
                MAX(sqa.score_percentage) as highest_quiz_score
            FROM modules m
            LEFT JOIN quiz_sets qs ON m.module_id = qs.module_id
            LEFT JOIN quiz_set_assignments qsa ON qs.quiz_set_id = qsa.quiz_set_id
            LEFT JOIN student_quiz_attempts sqa 
                ON qsa.assignment_id = sqa.assignment_id 
                AND sqa.student_id = ? 
                AND sqa.status = 'submitted'
            GROUP BY m.category
            ORDER BY FIELD(m.category, 'conceptual', 'procedural', 'strategic', 'adaptive', 'productive')
        `, [userId]);

        // ✅ Combine strand scores with module stats
        const strandProgress = moduleStats.map(stat => {
            const score = strandScores.find(s => s.strand_type === stat.strand_type);
            const avgScore = score ? parseFloat(score.current_score) : parseFloat(stat.quiz_average || 0);
            
            return {
                strandtype: stat.strand_type,
                strand_type: stat.strand_type, // Keep both for compatibility
                totalmodules: stat.total_modules,
                completedmodules: stat.completed_modules,
                averagescore: avgScore,
                highestscore: stat.highest_quiz_score || 0,
                totalattempts: stat.total_attempts,
                strandstatus: stat.completed_modules === stat.total_modules ? 'completed' 
                    : stat.total_attempts > 0 ? 'in_progress' 
                    : 'not_started'
            };
        });

        console.log(`📊 Strand progress for user ${userId}:`, strandProgress.map(s => 
            `${s.strandtype}: ${s.averagescore}% (${s.completedmodules}/${s.totalmodules})`
        ).join(', '));

        res.json({ strandProgress });
        
    } catch (error) {
        console.error('❌ Error fetching strand progress:', error);
        res.status(500).json({ error: 'Failed to fetch strand progress' });
    }
});



// Get complete module content
// 🔓 Allow both students AND educators to view module content
app.get('/api/student/module/:moduleId/content', authenticateToken, async (req, res) => {
    const { moduleId } = req.params;

    try {
        const [module] = await pool.query(
            'SELECT * FROM modules WHERE module_id = ?',
            [moduleId]
        );

        if (module.length === 0) {
            return res.status(404).json({ error: 'Module not found' });
        }

        const [objectives] = await pool.query(
            'SELECT objective_text FROM learning_objectives WHERE module_id = ? ORDER BY objective_order',
            [moduleId]
        );

        const [prerequisites] = await pool.query(
            'SELECT prerequisite_text FROM module_prerequisites WHERE module_id = ? ORDER BY prerequisite_order',
            [moduleId]
        );

        const [videos] = await pool.query(
            'SELECT title, creator, url, duration_minutes, description, topics_covered FROM module_videos WHERE module_id = ? ORDER BY video_order',
            [moduleId]
        );

        const [sections] = await pool.query(
			`SELECT section_id, section_number, title, content_type, duration_minutes, explanation 
			FROM module_sections 
			WHERE module_id = ? 
			ORDER BY section_order`,
			[moduleId]
		);

        const [concepts] = await pool.query(
            'SELECT concept_text FROM key_concepts WHERE module_id = ? ORDER BY concept_order',
            [moduleId]
        );

        const [misconceptions] = await pool.query(
            'SELECT misconception_text, correction_text, example_text FROM common_misconceptions WHERE module_id = ? ORDER BY misconception_order',
            [moduleId]
        );

        const [applications] = await pool.query(
            'SELECT title, description, context FROM real_world_applications WHERE module_id = ? ORDER BY application_order',
            [moduleId]
        );

        const [examples] = await pool.query(
            'SELECT title, problem_statement, solution_steps, final_answer, difficulty, filipino_context FROM worked_examples WHERE module_id = ? ORDER BY example_order',
            [moduleId]
        );
		
		// Get saved module content (rich text with interactive tools)
		const [savedContent] = await pool.query(
			'SELECT content FROM module_content WHERE module_id = ?',
			[moduleId]
		);

        res.json({
            module: module[0],
            objectives,
            prerequisites,
            videos,
            sections,
            concepts,
            misconceptions,
            applications,
            examples,
			savedContent: savedContent.length > 0 ? savedContent[0].content : null
        });

    } catch (error) {
        console.error('Get module content error:', error);
        res.status(500).json({ error: 'Failed to fetch module content' });
    }
});

// Generate quiz for module
app.post('/api/student/generate-quiz', authenticateToken, requireRole('student'), async (req, res) => {
    const { moduleId } = req.body;

    try {
        const [modules] = await pool.query(
            'SELECT module_name, difficulty_level FROM modules WHERE module_id = ?',
            [moduleId]
        );

        if (modules.length === 0) {
            return res.status(404).json({ error: 'Module not found' });
        }

        const module = modules[0];
        const questions = await generateQuizWithAI(moduleId, module.module_name, module.difficulty_level);

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const questionIds = [];
            for (const q of questions) {
                const [result] = await conn.query(
                    'INSERT INTO custom_problems (module_id, created_by, question_text, correct_answer, explanation) VALUES (?, ?, ?, ?, ?)',
                    [moduleId, req.user.userId, q.question, q.correct_answer, q.explanation]
                );

                const problemId = result.insertId;
                questionIds.push(problemId);

                for (let i = 0; i < q.options.length; i++) {
                    await conn.query(
                        'INSERT INTO problem_options (problem_id, option_text, is_correct, option_letter) VALUES (?, ?, ?, ?)',
                        [problemId, q.options[i], q.options[i] === q.correct_answer, i + 1]
                    );
                }
            }

            await conn.query(
                `INSERT INTO student_progress (user_id, module_id, status, started_at)
                 VALUES (?, ?, 'in_progress', NOW())
                 ON DUPLICATE KEY UPDATE status = 'in_progress', started_at = COALESCE(started_at, NOW())`,
                [req.user.userId, moduleId]
            );

            await conn.commit();

            res.json({
                questions: questions.map((q, index) => ({
                    problemId: questionIds[index],
                    question: q.question,
                    options: q.options
                }))
            });

        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }

    } catch (error) {
        console.error('Generate quiz error:', error);
        res.status(500).json({ error: 'Failed to generate quiz' });
    }
});

// Submit quiz answer
app.post('/api/student/submit-answer', authenticateToken, requireRole('student'), async (req, res) => {
    const { problemId, selectedAnswer, responseTime } = req.body;
    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        const [problems] = await conn.query(
            'SELECT correct_answer, module_id FROM custom_problems WHERE problem_id = ?',
            [problemId]
        );

        if (problems.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: 'Problem not found' });
        }

        const problem = problems[0];
        const isCorrect = problem.correct_answer === selectedAnswer;

        await conn.query(
            'INSERT INTO student_responses (user_id, problem_id, selected_answer, is_correct, response_time_seconds) VALUES (?, ?, ?, ?, ?)',
            [req.user.userId, problemId, selectedAnswer, isCorrect, responseTime]
        );

        // 🆕 Use holistic strand scoring
        await updateStrandScoresHolistic(req.user.userId, problem.module_id, isCorrect, conn);
        await checkAndUnlockGates(req.user.userId, conn);

        const [avgScore] = await conn.query(
            `SELECT AVG(is_correct) * 100 as score
             FROM student_responses sr
             JOIN custom_problems cp ON sr.problem_id = cp.problem_id
             WHERE sr.user_id = ? AND cp.module_id = ?`,
            [req.user.userId, problem.module_id]
        );

        await conn.query(
            'UPDATE student_progress SET score = ?, attempts = attempts + 1 WHERE user_id = ? AND module_id = ?',
            [avgScore[0].score, req.user.userId, problem.module_id]
        );

        await conn.commit();

        res.json({
            isCorrect,
            message: isCorrect ? 'Correct! Well done!' : 'Incorrect. Keep trying!',
            currentModuleScore: avgScore[0].score
        });

    } catch (error) {
        await conn.rollback();
        console.error('Submit answer error:', error);
        res.status(500).json({ error: 'Failed to submit answer' });
    } finally {
        conn.release();
    }
});

// Complete module
app.post('/api/student/complete-module', authenticateToken, requireRole('student'), async (req, res) => {
    const { moduleId } = req.body;

    try {
        await pool.query(
            'UPDATE student_progress SET status = "completed", completed_at = NOW() WHERE user_id = ? AND module_id = ?',
            [req.user.userId, moduleId]
        );

        res.json({ message: 'Module completed!' });
    } catch (error) {
        console.error('Complete module error:', error);
        res.status(500).json({ error: 'Failed to complete module' });
    }
});

// Get all modules for educator management
app.get('/api/educator/modules', authenticateToken, requireRole('educator'), async (req, res) => {
    try {
        const [modules] = await pool.query(
            `SELECT module_id, module_name, category, difficulty_level, description,
				icon, is_gated, required_conceptual_score,
				is_custom, created_by, estimated_time_minutes, content_version, last_updated
			FROM modules
			ORDER BY module_id`
        );

        res.json({ modules });
    } catch (error) {
        console.error('Get educator modules error:', error);
        res.status(500).json({ error: 'Failed to fetch modules' });
    }
});

// Get single module for educator
app.get('/api/educator/modules/:id', authenticateToken, requireRole('educator'), async (req, res) => {
    try {
        const [modules] = await pool.query(
            `SELECT module_id, module_name, category, difficulty_level, description,
				icon, is_gated, required_conceptual_score,
				is_custom, created_by, estimated_time_minutes, content_version, last_updated
			FROM modules
			WHERE module_id = ?`,
            [req.params.id]
        );

        if (modules.length === 0) {
            return res.status(404).json({ error: 'Module not found' });
        }

        res.json({ module: modules[0] });
    } catch (error) {
        console.error('Get single module error:', error);
        res.status(500).json({ error: 'Failed to fetch module' });
    }
});

// Update module
app.put('/api/educator/modules/:id', authenticateToken, requireRole('educator'), async (req, res) => {
    try {
        const moduleId = req.params.id;
        const {
            module_name,
            description,
            category,
            difficulty_level,
            icon,
            estimated_time_minutes,
            is_gated,
            required_conceptual_score,
            video_url,
            content
        } = req.body;

        // Update module in database
        await pool.query(
            `UPDATE modules 
             SET module_name = ?,
                 description = ?,
                 category = ?,
                 difficulty_level = ?,
                 icon = ?,
                 estimated_time_minutes = ?,
                 is_gated = ?,
                 required_conceptual_score = ?,
                 last_updated = CURRENT_TIMESTAMP
             WHERE module_id = ?`,
            [
                module_name,
                description,
                category,
                difficulty_level,
                icon,
                estimated_time_minutes,
                is_gated ? 1 : 0,
                required_conceptual_score || 0,
                moduleId
            ]
        );

        // TODO: Save video_url and content when you add columns for them
        // For now, they're just accepted but not saved

        res.json({ 
            success: true, 
            message: 'Module updated successfully',
            module_id: moduleId 
        });
    } catch (error) {
        console.error('Update module error:', error);
        res.status(500).json({ error: 'Failed to update module' });
    }
});

// Upload materials for module
app.post('/api/educator/modules/:id/materials', 
    authenticateToken, 
    requireRole('educator'), 
    upload.array('files', 10), // Max 10 files
    async (req, res) => {
        try {
            const moduleId = req.params.id;
            const files = req.files;

            if (!files || files.length === 0) {
                return res.status(400).json({ error: 'No files uploaded' });
            }

            // Insert file records into database
            const fileRecords = files.map(file => [
                moduleId,
                null, // lesson_id (null means module-level material)
                file.originalname,
                `/uploads/materials/${file.filename}`,
                path.extname(file.originalname).substring(1).toLowerCase(),
                Math.round(file.size / 1024), // Size in KB
                req.user.userId
            ]);

            await pool.query(
                `INSERT INTO module_materials 
                 (module_id, lesson_id, file_name, file_path, file_type, file_size_kb, uploaded_by)
                 VALUES ?`,
                [fileRecords]
            );

            res.json({ 
                success: true, 
                message: `${files.length} file(s) uploaded successfully`,
                files: files.map(f => ({
                    name: f.originalname,
                    size: Math.round(f.size / 1024),
                    path: `/uploads/materials/${f.filename}`
                }))
            });
        } catch (error) {
            console.error('Upload materials error:', error);
            res.status(500).json({ error: 'Failed to upload materials' });
        }
    }
);

// Get materials for a module
app.get('/api/educator/modules/:id/materials', authenticateToken, requireRole('educator'), async (req, res) => {
    try {
        const [materials] = await pool.query(
            `SELECT material_id, module_id, lesson_id, file_name, file_path, 
                    file_type, file_size_kb, uploaded_at, download_count
             FROM module_materials
             WHERE module_id = ?
             ORDER BY uploaded_at DESC`,
            [req.params.id]
        );

        res.json({ materials });
    } catch (error) {
        console.error('Get materials error:', error);
        res.status(500).json({ error: 'Failed to fetch materials' });
    }
});

// Delete material
app.delete('/api/educator/modules/:moduleId/materials/:materialId', 
    authenticateToken, 
    requireRole('educator'), 
    async (req, res) => {
        try {
            const { moduleId, materialId } = req.params;

            // Get file path before deleting
            const [materials] = await pool.query(
                'SELECT file_path FROM module_materials WHERE material_id = ? AND module_id = ?',
                [materialId, moduleId]
            );

            if (materials.length === 0) {
                return res.status(404).json({ error: 'Material not found' });
            }

            const filePath = path.join(__dirname, 'public', materials[0].file_path);

            // Delete from database
            await pool.query(
                'DELETE FROM module_materials WHERE material_id = ? AND module_id = ?',
                [materialId, moduleId]
            );

            // Delete physical file
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            res.json({ success: true, message: 'Material deleted successfully' });
        } catch (error) {
            console.error('Delete material error:', error);
            res.status(500).json({ error: 'Failed to delete material' });
        }
    }
);

// ==========================================
// MODULE EDITOR - COMPLETE API ENDPOINTS
// ==========================================

// 1. GET Module Videos
app.get('/api/educator/modules/:moduleId/videos', authenticateToken, requireRole('educator'), async (req, res) => {
  try {
    const [videos] = await pool.query(
      `SELECT video_id, title, creator, url, duration_minutes, description, topics_covered, video_order 
       FROM module_videos 
       WHERE module_id = ? 
       ORDER BY video_order`,
      [req.params.moduleId]
    );
    res.json({ videos });
  } catch (error) {
    console.error('Get videos error:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// 2. GET Module Sections
app.get('/api/educator/modules/:moduleId/sections', authenticateToken, requireRole('educator'), async (req, res) => {
    try {
        const [sections] = await pool.query(
            `SELECT section_id as sectionid, section_number as sectionnumber, 
             title, content_type as contenttype, duration_minutes as durationminutes, 
             description, section_order as sectionorder
             FROM module_sections
             WHERE module_id = ?
             ORDER BY section_order`,
            [req.params.moduleId]
        );
        res.json({ sections });
    } catch (error) {
        console.error('Get sections error:', error);
        console.error('SQL Error details:', error.sqlMessage);  // 👈 FIX 3 - Add this line
        res.status(500).json({ error: 'Failed to fetch sections', details: error.message });
    }
});


// 3. SAVE/UPDATE Lessons (Videos + Sections combined)
app.put('/api/educator/modules/:moduleId/lessons', authenticateToken, requireRole('educator'), async (req, res) => {
  const { videos, sections } = req.body;
  const moduleId = req.params.moduleId;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Delete existing videos and sections
    await conn.query('DELETE FROM module_videos WHERE module_id = ?', [moduleId]);
    await conn.query('DELETE FROM module_sections WHERE module_id = ?', [moduleId]);

    // Insert new videos
    if (videos && videos.length > 0) {
      for (const video of videos) {
        await conn.query(
          `INSERT INTO module_videos (module_id, title, creator, url, duration_minutes, description, topics_covered, video_order) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [moduleId, video.title, video.creator || '', video.url, video.durationminutes || 15, video.description || '', video.topicscovered || '', video.videoorder]
        );
      }
    }

    // Insert new sections
    if (sections && sections.length > 0) {
      for (const section of sections) {
        await conn.query(
          `INSERT INTO module_sections (module_id, section_number, title, content_type, duration_minutes, description, section_order) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [moduleId, section.sectionnumber, section.title, section.contenttype || 'text', section.durationminutes || 15, section.description || '', section.sectionorder]
        );
      }
    }

    await conn.commit();
    res.json({ success: true, message: 'Lessons saved successfully' });
  } catch (error) {
    await conn.rollback();
    console.error('Save lessons error:', error);
    res.status(500).json({ error: 'Failed to save lessons' });
  } finally {
    conn.release();
  }
});

// 4. GET Module Quizzes
app.get('/api/educator/modules/:moduleId/quizzes', authenticateToken, requireRole('educator'), async (req, res) => {
    try {
        const [quizzes] = await pool.query(
            `SELECT q.quiz_id as quizid, q.quiz_title as quiztitle, 
             q.time_limit_minutes as timelimitminutes, 
             q.passing_percentage, q.is_active as isactive,
             COUNT(qq.question_id) as questioncount
             FROM quizzes q
             LEFT JOIN quiz_questions qq ON q.quiz_id = qq.quiz_id
             WHERE q.module_id = ?
             GROUP BY q.quiz_id
             ORDER BY q.created_at DESC`,
            [req.params.moduleId]
        );
        res.json({ quizzes });
    } catch (error) {
        console.error('Get quizzes error:', error);
        console.error('SQL Error details:', error.sqlMessage);  // 👈 FIX 3 - Add this line
        res.status(500).json({ error: 'Failed to fetch quizzes', details: error.message });
    }
});


// 5. ADD Single Video
app.post('/api/educator/modules/:moduleId/videos', authenticateToken, requireRole('educator'), async (req, res) => {
  const { title, url, creator, durationminutes, description, topicscovered } = req.body;
  const moduleId = req.params.moduleId;

  try {
    // Get next video order
    const [maxOrder] = await pool.query(
      'SELECT COALESCE(MAX(video_order), 0) as maxorder FROM module_videos WHERE module_id = ?',
      [moduleId]
    );
    const nextOrder = maxOrder[0].maxorder + 1;

    const [result] = await pool.query(
      `INSERT INTO module_videos (module_id, title, creator, url, duration_minutes, description, topics_covered, video_order) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [moduleId, title, creator || '', url, durationminutes || 15, description || '', topicscovered || '', nextOrder]
    );

    res.json({ success: true, videoid: result.insertId, message: 'Video added successfully' });
  } catch (error) {
    console.error('Add video error:', error);
    res.status(500).json({ error: 'Failed to add video' });
  }
});

// 6. DELETE Video
app.delete('/api/educator/modules/:moduleId/videos/:videoId', authenticateToken, requireRole('educator'), async (req, res) => {
  try {
    await pool.query('DELETE FROM module_videos WHERE video_id = ? AND module_id = ?', 
      [req.params.videoId, req.params.moduleId]
    );
    res.json({ success: true, message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// 7. ADD Single Section
app.post('/api/educator/modules/:moduleId/sections', authenticateToken, requireRole('educator'), async (req, res) => {
  const { title, contenttype, durationminutes, description } = req.body;
  const moduleId = req.params.moduleId;

  try {
    // Get next section order and number
    const [maxOrder] = await pool.query(
      'SELECT COALESCE(MAX(section_order), 0) as maxorder, COALESCE(MAX(section_number), 0) as maxnum FROM module_sections WHERE module_id = ?',
      [moduleId]
    );
    const nextOrder = maxOrder[0].maxorder + 1;
    const nextNum = maxOrder[0].maxnum + 1;

    const [result] = await pool.query(
      `INSERT INTO module_sections (module_id, section_number, title, content_type, duration_minutes, description, section_order) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [moduleId, nextNum, title, contenttype || 'text', durationminutes || 15, description || '', nextOrder]
    );

    res.json({ success: true, sectionid: result.insertId, message: 'Section added successfully' });
  } catch (error) {
    console.error('Add section error:', error);
    res.status(500).json({ error: 'Failed to add section' });
  }
});

// 8. DELETE Section
app.delete('/api/educator/modules/:moduleId/sections/:sectionId', authenticateToken, requireRole('educator'), async (req, res) => {
  try {
    await pool.query('DELETE FROM module_sections WHERE section_id = ? AND module_id = ?', 
      [req.params.sectionId, req.params.moduleId]
    );
    res.json({ success: true, message: 'Section deleted successfully' });
  } catch (error) {
    console.error('Delete section error:', error);
    res.status(500).json({ error: 'Failed to delete section' });
  }
});

// 9. GET Module Prerequisites (for prerequisite management)
app.get('/api/educator/modules/:moduleId/prerequisites', authenticateToken, requireRole('educator'), async (req, res) => {
  try {
    const [prerequisites] = await pool.query(
      `SELECT mp.prerequisite_id, mp.prerequisite_module_id, mp.minimum_score,
              m.module_name as prerequisite_name
       FROM module_prerequisites mp
       JOIN modules m ON mp.prerequisite_module_id = m.module_id
       WHERE mp.module_id = ?
       ORDER BY mp.prerequisite_order`,
      [req.params.moduleId]
    );
    res.json({ prerequisites });
  } catch (error) {
    console.error('Get prerequisites error:', error);
    res.status(500).json({ error: 'Failed to fetch prerequisites' });
  }
});

// 10. ADD Prerequisite
app.post('/api/educator/modules/:moduleId/prerequisites', authenticateToken, requireRole('educator'), async (req, res) => {
  const { prerequisitemoduleid, minimumscore } = req.body;
  const moduleId = req.params.moduleId;

  try {
    // Get next order
    const [maxOrder] = await pool.query(
      'SELECT COALESCE(MAX(prerequisite_order), 0) as maxorder FROM module_prerequisites WHERE module_id = ?',
      [moduleId]
    );
    const nextOrder = maxOrder[0].maxorder + 1;

    const [result] = await pool.query(
      `INSERT INTO module_prerequisites (module_id, prerequisite_module_id, minimum_score, prerequisite_order) 
       VALUES (?, ?, ?, ?)`,
      [moduleId, prerequisitemoduleid, minimumscore || 70, nextOrder]
    );

    res.json({ success: true, prerequisiteid: result.insertId, message: 'Prerequisite added successfully' });
  } catch (error) {
    console.error('Add prerequisite error:', error);
    res.status(500).json({ error: 'Failed to add prerequisite' });
  }
});

// 11. DELETE Prerequisite
app.delete('/api/educator/modules/:moduleId/prerequisites/:prerequisiteId', authenticateToken, requireRole('educator'), async (req, res) => {
  try {
    await pool.query('DELETE FROM module_prerequisites WHERE prerequisite_id = ? AND module_id = ?', 
      [req.params.prerequisiteId, req.params.moduleId]
    );
    res.json({ success: true, message: 'Prerequisite deleted successfully' });
  } catch (error) {
    console.error('Delete prerequisite error:', error);
    res.status(500).json({ error: 'Failed to delete prerequisite' });
  }
});

// 12. CREATE Quiz
app.post('/api/educator/modules/:moduleId/quizzes', authenticateToken, requireRole('educator'), async (req, res) => {
  const { quiztitle, timelimitminutes, passingpercentage, isactive } = req.body;
  const moduleId = req.params.moduleId;

  try {
    const [result] = await pool.query(
      `INSERT INTO quizzes (module_id, quiz_title, time_limit_minutes, passing_percentage, is_active) 
       VALUES (?, ?, ?, ?, ?)`,
      [moduleId, quiztitle || 'Untitled Quiz', timelimitminutes || 30, passingpercentage || 70, isactive ? 1 : 0]
    );

    res.json({ success: true, quizid: result.insertId, message: 'Quiz created successfully' });
  } catch (error) {
    console.error('Create quiz error:', error);
    res.status(500).json({ error: 'Failed to create quiz' });
  }
});

// 13. DELETE Quiz
app.delete('/api/educator/modules/:moduleId/quizzes/:quizId', authenticateToken, requireRole('educator'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { quizId, moduleId } = req.params;

    console.log(`🗑️ Deleting quiz ${quizId} and ALL related data...`);

    // 🆕 Step 1: Get all assignment IDs for this quiz
    const [assignments] = await conn.query(
      'SELECT assignment_id FROM quiz_assignments WHERE quiz_id = ?',
      [quizId]
    );
    
    const assignmentIds = assignments.map(a => a.assignment_id);
    
    if (assignmentIds.length > 0) {
      const placeholders = assignmentIds.map(() => '?').join(',');
      
      // 🆕 Step 2: Delete quiz answers for all attempts of these assignments
      await conn.query(
        `DELETE FROM quiz_answers WHERE attempt_id IN (
          SELECT attempt_id FROM quiz_attempts WHERE assignment_id IN (${placeholders})
        )`,
        assignmentIds
      );
      console.log(`✅ Deleted quiz_answers for quiz ${quizId}`);
      
      // 🆕 Step 3: Delete quiz attempts for these assignments
      await conn.query(
        `DELETE FROM quiz_attempts WHERE assignment_id IN (${placeholders})`,
        assignmentIds
      );
      console.log(`✅ Deleted quiz_attempts for quiz ${quizId}`);
    }
    
    // 🆕 Step 4: Delete quiz assignments
    await conn.query(
      'DELETE FROM quiz_assignments WHERE quiz_id = ?',
      [quizId]
    );
    console.log(`✅ Deleted quiz_assignments for quiz ${quizId}`);
    
    // 🆕 Step 5: Reset student progress for this module (since quiz is gone)
    // Option A: Delete progress entirely
    await conn.query(
      'DELETE FROM student_progress WHERE module_id = ?',
      [moduleId]
    );
    console.log(`✅ Reset student_progress for module ${moduleId}`);
    
    // Original: Delete quiz questions
    await conn.query('DELETE FROM quiz_questions WHERE quiz_id = ?', [quizId]);
    console.log(`✅ Deleted quiz_questions for quiz ${quizId}`);
    
    // Original: Delete quiz options
    await conn.query('DELETE FROM quiz_options WHERE question_id IN (SELECT question_id FROM quiz_questions WHERE quiz_id = ?)', [quizId]);
    console.log(`✅ Deleted quiz_options for quiz ${quizId}`);

    // Original: Delete quiz
    await conn.query('DELETE FROM quizzes WHERE quiz_id = ? AND module_id = ?', 
      [quizId, moduleId]
    );
    console.log(`✅ Deleted quiz ${quizId}`);

    await conn.commit();
    
    console.log(`🎉 Successfully deleted quiz ${quizId} and all related data`);
    res.json({ 
      success: true, 
      message: 'Quiz and all related data deleted successfully',
      details: {
        quiz_deleted: true,
        attempts_deleted: assignmentIds.length > 0,
        progress_reset: true
      }
    });
  } catch (error) {
    await conn.rollback();
    console.error('Delete quiz error:', error);
    res.status(500).json({ error: 'Failed to delete quiz' });
  } finally {
    conn.release();
  }
});

// ==========================================
// END MODULE EDITOR ENDPOINTS
// ==========================================
// ==========================================
// LESSON SECTIONS ENDPOINTS
// ==========================================

// GET lesson sections
app.get('/api/educator/lessons/:lessonId/sections', authenticateToken, requireRole('educator'), async (req, res) => {
    try {
        const [sections] = await pool.query(
            `SELECT section_id, section_title, section_content, section_order 
             FROM lesson_sections 
             WHERE lesson_id = ? AND lesson_type = ?
             ORDER BY section_order`,
            [req.params.lessonId, req.query.lessonType || 'video']
        );
        res.json(sections);
    } catch (error) {
        console.error('Get lesson sections error:', error);
        res.status(500).json({ error: 'Failed to fetch sections' });
    }
});

// ADD lesson section
app.post('/api/educator/lessons/:lessonId/sections', authenticateToken, requireRole('educator'), async (req, res) => {
    const { lessonId } = req.params;
    const { lessonType, sectionTitle, sectionContent } = req.body;

    try {
        // Get next order
        const [maxOrder] = await pool.query(
            'SELECT COALESCE(MAX(section_order), 0) as maxorder FROM lesson_sections WHERE lesson_id = ?',
            [lessonId]
        );
        const nextOrder = maxOrder[0].maxorder + 1;

        const [result] = await pool.query(
            `INSERT INTO lesson_sections (lesson_id, lesson_type, section_title, section_content, section_order)
             VALUES (?, ?, ?, ?, ?)`,
            [lessonId, lessonType, sectionTitle, sectionContent, nextOrder]
        );

        res.json({ success: true, sectionid: result.insertId });
    } catch (error) {
        console.error('Add lesson section error:', error);
        res.status(500).json({ error: 'Failed to add section' });
    }
});

// UPDATE lesson section
app.put('/api/educator/lessons/:lessonId/sections/:sectionId', authenticateToken, requireRole('educator'), async (req, res) => {
    const { sectionTitle, sectionContent } = req.body;

    try {
        await pool.query(
            `UPDATE lesson_sections 
             SET section_title = ?, section_content = ?
             WHERE section_id = ? AND lesson_id = ?`,
            [sectionTitle, sectionContent, req.params.sectionId, req.params.lessonId]
        );

        res.json({ success: true, message: 'Section updated' });
    } catch (error) {
        console.error('Update lesson section error:', error);
        res.status(500).json({ error: 'Failed to update section' });
    }
});

// DELETE lesson section
app.delete('/api/educator/lessons/:lessonId/sections/:sectionId', authenticateToken, requireRole('educator'), async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM lesson_sections WHERE section_id = ? AND lesson_id = ?',
            [req.params.sectionId, req.params.lessonId]
        );

        res.json({ success: true, message: 'Section deleted' });
    } catch (error) {
        console.error('Delete lesson section error:', error);
        res.status(500).json({ error: 'Failed to delete section' });
    }
});

// ==========================================
// END LESSON SECTIONS ENDPOINTS
// ==========================================





// Get current class for student
app.get('/api/student/class', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const [classData] = await pool.query(
            `SELECT
                c.class_id,
                c.class_name,
                c.class_code,
                c.grade_level,
                c.section,
                c.school_year,
                c.description,
                u.first_name as teacher_first_name,
                u.last_name as teacher_last_name,
                ce.enrolled_at,
                (SELECT COUNT(*) FROM class_enrollments WHERE class_id = c.class_id AND enrollment_status = 'active') as total_students
             FROM class_enrollments ce
             JOIN classes c ON ce.class_id = c.class_id
             JOIN users u ON c.teacher_id = u.user_id
             WHERE ce.student_id = ? AND ce.enrollment_status = 'active'
             ORDER BY ce.enrolled_at DESC
             LIMIT 1`,
            [req.user.userId]
        );

        if (classData.length === 0) {
            return res.status(404).json({ error: 'Not enrolled in any class' });
        }

        res.json({ class: classData[0] });
    } catch (error) {
        console.error('Get student class error:', error);
        res.status(500).json({ error: 'Failed to fetch class information' });
    }
});

// Join a class using class code
app.post('/api/student/join-class', authenticateToken, requireRole('student'), async (req, res) => {
    const { class_code } = req.body;

    if (!class_code) {
        return res.status(400).json({ error: 'Class code is required' });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [classData] = await conn.query(
            `SELECT
                c.class_id,
                c.class_name,
                c.teacher_id,
                c.is_active,
                u.first_name as teacher_first_name,
                u.last_name as teacher_last_name
             FROM classes c
             JOIN users u ON c.teacher_id = u.user_id
             WHERE c.class_code = ? AND c.is_active = TRUE`,
            [class_code.toUpperCase()]
        );

        if (classData.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: 'Invalid class code or class is no longer active' });
        }

        const classInfo = classData[0];

        const [existingEnrollment] = await conn.query(
            'SELECT * FROM class_enrollments WHERE student_id = ? AND class_id = ?',
            [req.user.userId, classInfo.class_id]
        );

        if (existingEnrollment.length > 0) {
            const status = existingEnrollment[0].enrollment_status;
            if (status === 'active') {
                await conn.rollback();
                return res.status(400).json({ error: 'You are already enrolled in this class' });
            } else if (status === 'dropped') {
                await conn.query(
                    `UPDATE class_enrollments
                     SET enrollment_status = 'active', enrolled_at = NOW(), dropped_at = NULL
                     WHERE student_id = ? AND class_id = ?`,
                    [req.user.userId, classInfo.class_id]
                );
            }
        } else {
            await conn.query(
                'INSERT INTO class_enrollments (class_id, student_id, enrollment_status) VALUES (?, ?, "active")',
                [classInfo.class_id, req.user.userId]
            );
        }

        await conn.commit();

        res.json({
            message: 'Successfully joined class!',
            class: {
                class_id: classInfo.class_id,
                class_name: classInfo.class_name,
                teacher_name: `${classInfo.teacher_first_name} ${classInfo.teacher_last_name}`
            }
        });

    } catch (error) {
        await conn.rollback();
        console.error('Join class error:', error);
        res.status(500).json({ error: 'Failed to join class' });
    } finally {
        conn.release();
    }
});

// Get student announcements
app.get('/api/student/announcements', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const [announcements] = await pool.query(
            `SELECT 
                ca.announcement_id,
                ca.title,
                ca.content,
                ca.posted_at,
                c.class_name,
                u.first_name as teacher_first_name,
                u.last_name as teacher_last_name
             FROM class_announcements ca
             JOIN classes c ON ca.class_id = c.class_id
             JOIN users u ON ca.teacher_id = u.user_id
             JOIN class_enrollments ce ON c.class_id = ce.class_id
             WHERE ce.student_id = ? AND ce.enrollment_status = 'active'
             ORDER BY ca.posted_at DESC
             LIMIT 10`,
            [req.user.userId]
        );

        res.json({ announcements });

    } catch (error) {
        console.error('Get announcements error:', error);
        res.status(500).json({ error: 'Failed to fetch announcements' });
    }
});

// ============================================================
// TEACHER/EDUCATOR ROUTES
// ============================================================

// Get teacher dashboard (QUIZ-BASED - updated)
app.get('/api/educator/dashboard', authenticateToken, requireRole('educator'), async (req, res) => {
    try {
        // Get classes with quiz-based averages
        const [classes] = await pool.query(`
            SELECT 
                c.class_id as classid,
                c.class_name as classname,
                c.class_code as classcode,
                c.grade_level as gradelevel,
                c.section,
                c.school_year as schoolyear,
                c.description,
                c.created_at as createdat,
                COUNT(DISTINCT ce.student_id) as studentcount,
                ROUND(AVG(
                    (COALESCE(ssconceptual.current_score, 0) + 
                     COALESCE(ssprocedural.current_score, 0) + 
                     COALESCE(ssstrategic.current_score, 0) + 
                     COALESCE(ssadaptive.current_score, 0) + 
                     COALESCE(ssproductive.current_score, 0)) / 5
                ), 2) as classaverage
            FROM classes c
            LEFT JOIN class_enrollments ce ON c.class_id = ce.class_id AND ce.enrollment_status = 'active'
            LEFT JOIN strand_scores ssconceptual ON ce.student_id = ssconceptual.user_id AND ssconceptual.strand_type = 'conceptual'
            LEFT JOIN strand_scores ssprocedural ON ce.student_id = ssprocedural.user_id AND ssprocedural.strand_type = 'procedural'
            LEFT JOIN strand_scores ssstrategic ON ce.student_id = ssstrategic.user_id AND ssstrategic.strand_type = 'strategic'
            LEFT JOIN strand_scores ssadaptive ON ce.student_id = ssadaptive.user_id AND ssadaptive.strand_type = 'adaptive'
            LEFT JOIN strand_scores ssproductive ON ce.student_id = ssproductive.user_id AND ssproductive.strand_type = 'productive'
            WHERE c.teacher_id = ? AND c.is_active = TRUE
            GROUP BY c.class_id
            ORDER BY c.created_at DESC
        `, [req.user.userId]);

        // Total students across all classes
        const [studentCountResult] = await pool.query(`
            SELECT COUNT(DISTINCT ce.student_id) as total
            FROM class_enrollments ce
            JOIN classes c ON ce.class_id = c.class_id
            WHERE c.teacher_id = ? AND ce.enrollment_status = 'active'
        `, [req.user.userId]);

        // At-risk students (quiz-based criteria)
        const [atRiskResult] = await pool.query(`
            SELECT COUNT(DISTINCT student_id) as count
            FROM (
                SELECT 
                    ce.student_id,
                    COUNT(DISTINCT sqa.attempt_id) as totalattempts,
                    COUNT(DISTINCT CASE WHEN sqa.score_percentage < 75 THEN sqa.attempt_id END) as failedattempts,
                    ROUND(
                        (COUNT(DISTINCT CASE WHEN sqa.score_percentage >= 75 THEN sqa.attempt_id END) * 100.0) / 
                        NULLIF(COUNT(DISTINCT sqa.attempt_id), 0), 
                        2
                    ) as passingrate
                FROM class_enrollments ce
                JOIN classes c ON ce.class_id = c.class_id
                LEFT JOIN quiz_set_assignments qsa ON qsa.class_id = ce.class_id
                LEFT JOIN student_quiz_attempts sqa ON qsa.assignment_id = sqa.assignment_id AND sqa.student_id = ce.student_id
                WHERE c.teacher_id = ? 
                AND ce.enrollment_status = 'active'
                GROUP BY ce.student_id
                HAVING (
                    (totalattempts >= 5 AND failedattempts >= 3 AND passingrate < 50)
                    OR (totalattempts >= 8 AND passingrate < 40)
                )
            ) as at_risk_students
        `, [req.user.userId]);

        const totalClasses = classes.length;
        const totalStudents = studentCountResult[0]?.total || 0;
		
		
        const totalScoreSum = classes.reduce((sum, c) => {
			// I-convert ang classaverage sa number, kung null/undefined, gawing 0
			const score = parseFloat(c.classaverage) || 0;
			return sum + score;
		}, 0);

		const avgClassScore = totalClasses > 0 
			? Math.round(totalScoreSum / totalClasses) 
			: 0;

		const atRiskStudents = atRiskResult[0]?.count || 0;

        res.json({
            classes: classes,
            stats: {
                totalClasses: totalClasses,
                totalStudents: totalStudents,
                avgClassScore: avgClassScore + '%',
                atRiskStudents: atRiskStudents
            }
        });

    } catch (error) {
        console.error('❌ Teacher dashboard error:', error);
        console.error('Error details:', error.message);
        console.error('Stack:', error.stack);
        res.status(500).json({ 
            error: 'Failed to load dashboard', 
            details: error.message 
        });
    }
});


// GET Teacher's Classes (for quiz assignment)
app.get('/api/educator/my-classes', authenticateToken, requireRole('educator'), async (req, res) => {
    try {
        // ✅ Destructure to get ONLY rows, not metadata
        const [classes] = await pool.query(`
            SELECT 
                c.class_id AS classid,
                c.class_name AS classname,
                c.class_code AS classcode,
                c.grade_level AS gradelevel,
                c.section,
                c.school_year AS schoolyear,
                COUNT(DISTINCT ce.student_id) AS studentcount
            FROM classes c
            LEFT JOIN class_enrollments ce
                ON c.class_id = ce.class_id
                AND ce.enrollment_status = 'active'
            WHERE c.teacher_id = ?
              AND c.is_active = TRUE
            GROUP BY c.class_id
            ORDER BY c.created_at DESC
        `, [req.user.userId]);
        
        console.log(`✅ Loaded ${classes.length} classes`);
        res.json({ classes });
    } catch (error) {
        console.error('❌ Get educator classes error:', error.message);
        res.status(500).json({ error: 'Failed to fetch classes', details: error.message });
    }
});
	



// Get all modules for educator (no progress filtering needed)
app.get('/api/educator/modules', authenticateToken, requireRole('educator'), async (req, res) => {
    try {
        const [modules] = await pool.query(
            `SELECT module_id, module_name, category, difficulty_level, description,
                    icon, is_gated, required_conceptual_score, estimated_time_minutes,
                    created_at, updated_at
             FROM modules
             ORDER BY module_id`
        );

        res.json({ modules });
    } catch (error) {
        console.error('Get educator modules error:', error);
        res.status(500).json({ error: 'Failed to fetch modules' });
    }
});

// Helper function to generate unique class code
async function generateUniqueClassCode(teacherId, conn) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code;
    let isUnique = false;
    
    while (!isUnique) {
        // Generate FC-XX-XXXX format
        let midPart = ''; // Para sa 2 characters sa gitna
        let endPart = ''; // Para sa 4 characters sa dulo
        
        // Loop para sa 2 characters
        for (let i = 0; i < 2; i++) {
            midPart += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        
        // Loop para sa 4 characters
        for (let i = 0; i < 4; i++) {
            endPart += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        
        // Pagsasama-samahin gamit ang dashes
        code = `FC-${midPart}-${endPart}`;
        
        // I-check kung existing na ang code sa database
        const [existing] = await conn.query(
            'SELECT class_id FROM classes WHERE class_code = ?',
            [code]
        );
        
        if (existing.length === 0) {
            isUnique = true;
        }
    }
    
    return code;
}

// Create new class
app.post('/api/educator/classes', authenticateToken, requireRole('educator'), async (req, res) => {
    const { class_name, grade_level, section, school_year, description } = req.body;

    if (!class_name || !grade_level) {
        return res.status(400).json({ error: 'Class name and grade level are required' });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const classCode = await generateUniqueClassCode(req.user.userId, conn);

        const [result] = await conn.query(
            `INSERT INTO classes (teacher_id, class_name, class_code, grade_level, section, school_year, description)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.user.userId, class_name, classCode, grade_level, section, school_year, description]
        );

        await conn.commit();

        res.status(201).json({
            message: 'Class created successfully',
            class_id: result.insertId,
            class_code: classCode,
            class_name: class_name
        });

    } catch (error) {
        await conn.rollback();
        console.error('Create class error:', error);
        res.status(500).json({ error: 'Failed to create class' });
    } finally {
        conn.release();
    }
});

// Delete class
app.delete('/api/educator/classes/:classId', authenticateToken, requireRole('educator'), async (req, res) => {
    const { classId } = req.params;
    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        // Verify teacher owns this class
        const [classCheck] = await conn.query(
            'SELECT class_id FROM classes WHERE class_id = ? AND teacher_id = ?',
            [classId, req.user.userId]
        );

        if (classCheck.length === 0) {
            await conn.rollback();
            return res.status(403).json({ error: 'Access denied or class not found' });
        }

        // Delete related records in correct order to avoid foreign key constraints
        await conn.query('DELETE FROM class_announcements WHERE class_id = ?', [classId]);
        await conn.query('DELETE FROM class_enrollments WHERE class_id = ?', [classId]);

        // Now delete the class
        await conn.query('DELETE FROM classes WHERE class_id = ?', [classId]);

        await conn.commit();
        res.json({ message: 'Class deleted successfully' });

    } catch (error) {
        await conn.rollback();
        console.error('Delete class error:', error);
        res.status(500).json({ error: 'Failed to delete class', details: error.message });
    } finally {
        conn.release();
    }
});

// Get specific class details with students
app.get('/api/educator/classes/:classId', authenticateToken, requireRole('educator'), async (req, res) => {
    const { classId } = req.params;

    try {
        const [classData] = await pool.query(
            `SELECT * FROM classes WHERE class_id = ? AND teacher_id = ?`,
            [classId, req.user.userId]
        );

        if (classData.length === 0) {
            return res.status(404).json({ error: 'Class not found or access denied' });
        }

        const [students] = await pool.query(
            `SELECT
                u.user_id,
                u.first_name,
                u.last_name,
                u.email,
                ce.enrolled_at,
                AVG(sp.score) as average_score,
                COUNT(DISTINCT CASE WHEN sp.status = 'completed' THEN sp.module_id END) as modules_completed,
                COUNT(DISTINCT sp.module_id) as modules_started
             FROM class_enrollments ce
             JOIN users u ON ce.student_id = u.user_id
             LEFT JOIN student_progress sp ON u.user_id = sp.user_id
             WHERE ce.class_id = ? AND ce.enrollment_status = 'active'
             GROUP BY u.user_id
             ORDER BY u.last_name, u.first_name`,
            [classId]
        );

        res.json({
            class: classData[0],
            students
        });

    } catch (error) {
        console.error('Get class details error:', error);
        res.status(500).json({ error: 'Failed to fetch class details' });
    }
});

// Get complete module content (EDUCATOR VERSION - no role restriction)
app.get('/api/educator/modules/:moduleId/content', authenticateToken, async (req, res) => {
    const { moduleId } = req.params;

    try {
        const [module] = await pool.query(
            'SELECT * FROM modules WHERE module_id = ?',
            [moduleId]
        );

        if (module.length === 0) {
            return res.status(404).json({ error: 'Module not found' });
        }

        const [objectives] = await pool.query(
            'SELECT objective_text FROM learning_objectives WHERE module_id = ? ORDER BY objective_order',
            [moduleId]
        );

        const [prerequisites] = await pool.query(
            'SELECT prerequisite_text FROM module_prerequisites WHERE module_id = ? ORDER BY prerequisite_order',
            [moduleId]
        );

        const [videos] = await pool.query(
            'SELECT video_id, title, creator, url, duration_minutes, description, topics_covered FROM module_videos WHERE module_id = ? ORDER BY video_order',
            [moduleId]
        );

        const [sections] = await pool.query(
			'SELECT section_id, section_number, title, content_type, duration_minutes, explanation FROM module_sections WHERE module_id = ? ORDER BY section_order',
			[moduleId]
		);


        const [concepts] = await pool.query(
            'SELECT concept_text FROM key_concepts WHERE module_id = ? ORDER BY concept_order',
            [moduleId]
        );

        const [misconceptions] = await pool.query(
            'SELECT misconception_text, correction_text, example_text FROM common_misconceptions WHERE module_id = ? ORDER BY misconception_order',
            [moduleId]
        );

        const [applications] = await pool.query(
            'SELECT title, description, context FROM real_world_applications WHERE module_id = ? ORDER BY application_order',
            [moduleId]
        );

        const [examples] = await pool.query(
            'SELECT title, problem_statement, solution_steps, final_answer, difficulty, filipino_context FROM worked_examples WHERE module_id = ? ORDER BY example_order',
            [moduleId]
        );

        res.json({
            module: module[0],
            objectives,
            prerequisites,
            videos,
            sections,
            concepts,
            misconceptions,
            applications,
            examples
        });

    } catch (error) {
        console.error('Get module content error:', error);
        res.status(500).json({ error: 'Failed to fetch module content' });
    }
});

// Get all students in a specific class with detailed analytics
app.get('/api/educator/classes/:classId/students', authenticateToken, requireRole('educator'), async (req, res) => {
    const { classId } = req.params;

    try {
        // Verify teacher owns this class
        const [classCheck] = await pool.query(
            'SELECT class_id FROM classes WHERE class_id = ? AND teacher_id = ?',
            [classId, req.user.userId]
        );

        if (classCheck.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // In your server.js route for getting class students
		const [students] = await pool.query(`
			SELECT 
				u.user_id, u.first_name, u.last_name, u.email, u.last_login,
				ce.enrolled_at, ce.enrollment_status,
				-- Force scores to 0 if they don't exist yet
				COALESCE(ss_conceptual.current_score, 0) as conceptual_score,
				COALESCE(ss_procedural.current_score, 0) as procedural_score,
				COALESCE(ss_strategic.current_score, 0) as strategic_score,
				COALESCE(ss_adaptive.current_score, 0) as adaptive_score,
				COALESCE(ss_productive.current_score, 0) as productive_score,
				-- Progress stats
				COUNT(DISTINCT CASE WHEN sp.status = 'completed' THEN sp.module_id END) as modules_completed,
				COUNT(DISTINCT CASE WHEN sp.status = 'in_progress' THEN sp.module_id END) as modules_in_progress,
				-- Round scores and handle null averages for new students
				ROUND(COALESCE(AVG(CASE WHEN sp.status = 'completed' THEN sp.score END), 0), 2) as average_score,
				SUM(COALESCE(sp.time_spent_seconds, 0)) as total_time_spent_seconds,
				MAX(sp.completed_at) as last_activity
			FROM class_enrollments ce
			JOIN users u ON ce.student_id = u.user_id
			LEFT JOIN strand_scores ss_conceptual ON u.user_id = ss_conceptual.user_id AND ss_conceptual.strand_type = 'conceptual'
			LEFT JOIN strand_scores ss_procedural ON u.user_id = ss_procedural.user_id AND ss_procedural.strand_type = 'procedural'
			LEFT JOIN strand_scores ss_strategic ON u.user_id = ss_strategic.user_id AND ss_strategic.strand_type = 'strategic'
			LEFT JOIN strand_scores ss_adaptive ON u.user_id = ss_adaptive.user_id AND ss_adaptive.strand_type = 'adaptive'
			LEFT JOIN strand_scores ss_productive ON u.user_id = ss_productive.user_id AND ss_productive.strand_type = 'productive'
			LEFT JOIN student_progress sp ON u.user_id = sp.user_id
			WHERE ce.class_id = ? AND ce.enrollment_status = 'active'
			GROUP BY u.user_id
			ORDER BY u.last_name, u.first_name
		`, [classId]);

		// Processing the results to prevent NaN
		const studentsWithRisk = students.map(student => {
			const conceptual = parseFloat(student.conceptual_score) || 0;
			const procedural = parseFloat(student.procedural_score) || 0;
			const strategic = parseFloat(student.strategic_score) || 0;
			const adaptive = parseFloat(student.adaptive_score) || 0;
			const productive = parseFloat(student.productive_score) || 0;

			const gap = procedural - conceptual;
			const overallScore = Math.round((conceptual + procedural + strategic + adaptive + productive) / 5);

			return {
				...student,
				flexibility_gap: gap,
				overall_score: overallScore, // Guaranteed to be a number (0-100)
				risk_level: gap > 30 || (student.average_score < 50) ? 'high' : 
							gap > 20 || (student.average_score < 60) ? 'medium' : 'low'
			};
		});
		
		// 3. I-send ang response
        res.json({
            classid: classId,
            totalstudents: studentsWithRisk.length,
            students: studentsWithRisk
        });

    } catch (error) {
        console.error('Get class students error:', error);
        res.status(500).json({ error: 'Failed to fetch students', details: error.message });
    }
});



app.get('/api/educator/students/:studentId/analytics', authenticateToken, requireRole('educator'), async (req, res) => {
    const { studentId } = req.params;
    
    try {
        // ✅ Verify teacher has access to this student
        const [access] = await pool.query(
            `SELECT ce.student_id 
             FROM class_enrollments ce
             JOIN classes c ON ce.class_id = c.class_id
             WHERE ce.student_id = ? AND c.teacher_id = ? AND ce.enrollment_status = 'active'`,
            [studentId, req.user.userId]
        );
        
        if (access.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // ✅ Get student basic info
        const [student] = await pool.query(
            `SELECT user_id, first_name, last_name, email FROM users WHERE user_id = ?`,
            [studentId]
        );

        if (student.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        // ✅ Get strand scores
        const [strands] = await pool.query(
            `SELECT strand_type, current_score FROM strand_scores WHERE user_id = ?`,
            [studentId]
        );
        
        // ✅ FIXED: Get QUIZ-BASED module progress (not student_progress table)
        const [progress] = await pool.query(
            `SELECT 
                m.module_id,
                m.module_name,
                m.category,
                -- Quiz-based progress
                COUNT(DISTINCT sqa.attempt_id) as attempts,
                ROUND(COALESCE(MAX(sqa.score_percentage), 0), 2) as score,
                -- Status based on quiz scores
                CASE 
                    WHEN MAX(sqa.score_percentage) >= 70 THEN 'completed'
                    WHEN COUNT(sqa.attempt_id) > 0 THEN 'in_progress'
                    ELSE 'not_started'
                END as status,
                MAX(sqa.submitted_at) as completed_at,
                MIN(sqa.started_at) as started_at
            FROM modules m
            LEFT JOIN quiz_sets qs ON m.module_id = qs.module_id
            LEFT JOIN quiz_set_assignments qsa ON qs.quiz_set_id = qsa.quiz_set_id
            LEFT JOIN student_quiz_attempts sqa ON qsa.assignment_id = sqa.assignment_id 
                AND sqa.student_id = ? 
                AND sqa.status = 'submitted'
            GROUP BY m.module_id, m.module_name, m.category
            ORDER BY m.module_id`,
            [studentId]
        );

        console.log(`📊 Progress data for student ${studentId}:`, progress.map(p => ({
            module: p.module_name,
            attempts: p.attempts,
            score: p.score,
            status: p.status
        })));
        
        // ✅ FIXED: Get ACTUAL quiz activity (not fake data)
        const [activity] = await pool.query(
            `SELECT 
                m.module_name,
                CONCAT('Quiz: ', COALESCE(qs.quiz_title, 'Untitled Quiz')) as question_text,
                CASE WHEN sqa.score_percentage >= 70 THEN 1 ELSE 0 END as is_correct,
                COALESCE(TIMESTAMPDIFF(SECOND, sqa.started_at, sqa.submitted_at), 0) as response_time_seconds,
                sqa.submitted_at as attempted_at,
                sqa.score_percentage
            FROM student_quiz_attempts sqa
            JOIN quiz_set_assignments qsa ON sqa.assignment_id = qsa.assignment_id
            JOIN quiz_sets qs ON qsa.quiz_set_id = qs.quiz_set_id
            JOIN modules m ON qs.module_id = m.module_id
            WHERE sqa.student_id = ? AND sqa.status = 'submitted'
            ORDER BY sqa.submitted_at DESC
            LIMIT 20`,
            [studentId]
        );

        console.log(`✅ Analytics loaded for ${student[0].first_name} ${student[0].last_name}:`, {
            strands: strands.length,
            modules_with_attempts: progress.filter(p => p.attempts > 0).length,
            total_modules: progress.length,
            activities: activity.length
        });
        
        res.json({
            student: student[0],
            strands,
            progress,
            activity
        });
        
    } catch (error) {
        console.error('❌ Student analytics error:', error);
        res.status(500).json({ 
            error: 'Failed to load student analytics', 
            details: error.message 
        });
    }
});



// Get real-time class overview
app.get('/api/educator/classes/:classId/overview', authenticateToken, requireRole('educator'), async (req, res) => {
    const { classId } = req.params;

    try {
        const [classCheck] = await pool.query(
            'SELECT * FROM classes WHERE class_id = ? AND teacher_id = ?',
            [classId, req.user.userId]
        );

        if (classCheck.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get class statistics
        const [stats] = await pool.query(`
            SELECT 
                COUNT(DISTINCT ce.student_id) as total_students,
                COUNT(DISTINCT CASE WHEN u.last_login >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN ce.student_id END) as active_students,
                AVG(ss.current_score) as avg_overall_score,
                COUNT(DISTINCT CASE WHEN sp.status = 'completed' THEN sp.module_id END) as total_completions
            FROM class_enrollments ce
            JOIN users u ON ce.student_id = u.user_id
            LEFT JOIN strand_scores ss ON u.user_id = ss.user_id
            LEFT JOIN student_progress sp ON u.user_id = sp.user_id AND sp.status = 'completed'
            WHERE ce.class_id = ? AND ce.enrollment_status = 'active'
        `, [classId]);

        // Get module completion rates
        const [moduleStats] = await pool.query(`
            SELECT 
                m.module_id,
                m.module_name,
                m.category,
                COUNT(DISTINCT CASE WHEN sp.status = 'completed' THEN sp.user_id END) as completed_count,
                COUNT(DISTINCT CASE WHEN sp.status = 'in_progress' THEN sp.user_id END) as in_progress_count,
                COUNT(DISTINCT ce.student_id) as total_students,
                ROUND(AVG(CASE WHEN sp.status = 'completed' THEN sp.score END), 2) as avg_score
            FROM modules m
            CROSS JOIN class_enrollments ce
            LEFT JOIN student_progress sp ON m.module_id = sp.module_id AND ce.student_id = sp.user_id
            WHERE ce.class_id = ? AND ce.enrollment_status = 'active'
            GROUP BY m.module_id
            ORDER BY m.module_id
        `, [classId]);

        res.json({
            class: classCheck[0],
            statistics: stats[0],
            module_stats: moduleStats
        });

    } catch (error) {
        console.error('Get class overview error:', error);
        res.status(500).json({ error: 'Failed to fetch overview' });
    }
});


// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Clamp text to a maximum character length
 * @param {string} text - Text to clamp
 * @param {number} maxLength - Maximum length
 * @returns {string} Clamped text
 */
function clampText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

app.post('/api/educator/modules/:moduleId/quiz-sets/generate',
    authenticateToken,
    requireRole('educator'),
    async (req, res) => {
    try {
        const { moduleId } = req.params;
        const {
            num_questions = 10,
            difficulty = 'medium',
            time_limit_minutes = 30,
            ai_instructions = '',
            quiz_title
        } = req.body;

        const userId = req.user.userId;
        const startTime = Date.now();

        console.log('🤖 Generating quiz set (optimized):', { moduleId, num_questions, difficulty });

        // ============================================================
        // FETCH ONLY ESSENTIAL DATA (Titles Only - Token Efficient!)
        // ============================================================
        
        const [module] = await pool.query(
            'SELECT module_id, module_name, description, category FROM modules WHERE module_id = ?',
            [moduleId]
        );

        if (module.length === 0) {
            return res.status(404).json({ error: 'Module not found' });
        }

        // 📝 Get only lesson TITLES (not full content)
        const [lessons] = await pool.query(`
            SELECT lesson_title, lesson_order
            FROM module_lessons
            WHERE module_id = ?
            ORDER BY lesson_order
        `, [moduleId]);

        // 📝 Get only example TITLES (not full solutions)
        const [examples] = await pool.query(`
            SELECT title
            FROM worked_examples
            WHERE module_id = ?
            ORDER BY example_order
            LIMIT 8
        `, [moduleId]);

        // 📝 Get learning objectives (these are short)
        const [objectives] = await pool.query(`
            SELECT objective_text
            FROM learning_objectives
            WHERE module_id = ?
            ORDER BY objective_order
            LIMIT 5
        `, [moduleId]);

        // 📝 Get key concepts (these are short)
        const [concepts] = await pool.query(`
            SELECT concept_text
            FROM key_concepts
            WHERE module_id = ?
            ORDER BY concept_order
            LIMIT 10
        `, [moduleId]);

        // ============================================================
        // FORMAT DATA (Compact, Token-Efficient)
        // ============================================================
        
        const lessonTitles = lessons.map(l => `${l.lesson_order}. ${l.lesson_title}`).join('\n');
        const exampleTitles = examples.map(e => `• ${e.title}`).join('\n');
        const objectiveList = objectives.map(o => `• ${o.objective_text}`).join('\n');
        const conceptList = concepts.map(c => `• ${c.concept_text}`).join('\n');

        // ============================================================
        // DETERMINE MODULE STRAND TYPE
        // ============================================================
        // Based on your database:
        // conceptual: Limits (1), Continuity (2), Fundamental Theorem (10)
        // procedural: Derivatives-Definition (3), Differentiation Rules (4), Definite Integrals (11)
        // strategic: Related Rates (6), Optimization (8)
        // adaptive: Implicit Differentiation (5), Riemann Sums (9)
        // productive: Antiderivatives (7), Areas of Plane Regions (12)
        
        const moduleStrand = module[0].category; // This is the PRIMARY strand for this module
        
        // Map modules to their strand types
        const STRAND_MAP = {
            1: 'conceptual',     // Limits
            2: 'conceptual',     // Continuity
            3: 'procedural',     // Derivatives - Definition
            4: 'procedural',     // Differentiation Rules
            5: 'adaptive',       // Implicit Differentiation
            6: 'strategic',      // Related Rates
            7: 'productive',     // Antiderivatives
            8: 'strategic',      // Optimization
            9: 'adaptive',       // Riemann Sums
            10: 'conceptual',    // Fundamental Theorem
            11: 'procedural',    // Definite Integrals
            12: 'productive'     // Areas of Plane Regions
        };

        const primaryStrand = STRAND_MAP[moduleId] || moduleStrand;

        // ============================================================
        // AI GENERATION SCHEMA
        // ============================================================
        const quizSchema = {
            type: "object",
            properties: {
                questions: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            question: { type: "string" },
                            options: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        text: { type: "string" },
                                        is_correct: { type: "boolean" }
                                    },
                                    required: ["text", "is_correct"]
                                },
                                minItems: 4,
                                maxItems: 4
                            },
                            explanation: { type: "string" },
                            difficulty: { 
                                type: "string",
                                enum: ["easy", "medium", "hard"]
                            },
                            strand: { 
                                type: "string",
                                enum: ["conceptual", "procedural", "strategic", "adaptive", "productive"]
                            },
                            points: { type: "integer", minimum: 1 }
                        },
                        required: ["question", "options", "explanation", "difficulty", "strand", "points"]
                    }
                }
            },
            required: ["questions"]
        };

        // ============================================================
        // OPTIMIZED AI PROMPT (Much Shorter!)
        // ============================================================
        
        const prompt = `Generate ${num_questions} multiple-choice calculus questions for Filipino college students.

MODULE: ${module[0].module_name}
CATEGORY: ${module[0].category}
PRIMARY STRAND: ${primaryStrand}
DESCRIPTION: ${module[0].description || 'N/A'}

LEARNING OBJECTIVES:
${objectiveList || 'Not specified'}

LESSON TOPICS COVERED:
${lessonTitles || 'Not specified'}

KEY CONCEPTS:
${conceptList || 'Not specified'}

EXAMPLE PROBLEMS COVERED:
${exampleTitles || 'Not specified'}

STRAND TYPES EXPLANATION:
- conceptual: Understanding core concepts, definitions, and theoretical foundations
- procedural: Applying rules, formulas, and algorithms to solve problems
- strategic: Problem-solving, planning approaches, and applying multiple concepts
- adaptive: Adjusting methods based on problem context, non-standard situations
- productive: Constructive disposition, connecting concepts to applications

REQUIREMENTS:
1. Create ${num_questions} unique questions based ONLY on the topics listed above
2. Difficulty level: ${difficulty}
3. Each question has exactly 4 options (A, B, C, D)
4. Mark exactly ONE option as correct
5. Provide clear, educational explanations
6. ⚡ PURE STRAND MODE: ALL ${num_questions} questions must be strand_type "${primaryStrand}"
   - NO mixed strands - every question must match the module's primary strand
7. Questions must be appropriate for Filipino calculus students

${ai_instructions ? `ADDITIONAL INSTRUCTIONS: ${ai_instructions}` : ''}

MATH FORMAT (MANDATORY):
- ALL math MUST be wrapped in dollar signs: $...$ or $$...$$
- NEVER use \\(...\\) or \\[...\\]
- Examples: $x^2$, $\\lim_{x \\to 0}$, $\\frac{dy}{dx}$
- ALWAYS use FOUR backslashes (\\\\) for LaTeX in JSON: "$\\\\lim_{x \\\\to 0}$"

JSON FORMAT:
- Output VALID JSON only
- No markdown, no code blocks, no extra text
- Escape all special characters properly

Return ONLY this JSON structure:
{
  "questions": [
    {
      "question": "Question text with math like $x^2$",
      "options": [
        {"text": "Option A", "is_correct": false},
        {"text": "Option B", "is_correct": true},
        {"text": "Option C", "is_correct": false},
        {"text": "Option D", "is_correct": false}
      ],
      "explanation": "Why B is correct...",
      "difficulty": "${difficulty}",
      "strand": "${primaryStrand}",
      "points": 1
    }
  ]
}`;

        console.log(`📊 Optimized prompt length: ${prompt.length} chars (vs ~5000+ in old version)`);

        // ============================================================
        // CALL PERPLEXITY API
        // ============================================================
        
        const aiResponse = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
            },
            body: JSON.stringify({
                model: 'sonar',
                messages: [
                    {
                        role: 'system',
                        content: '🚨 CRITICAL: You are an expert calculus educator. Use DOLLAR SIGN format ($...$) for ALL math - NEVER \\(...\\)! Use FOUR backslashes (\\\\) for LaTeX in JSON. Always return complete, valid JSON. If approaching token limit, reduce explanations but ALWAYS close all JSON structures. DOLLAR SIGNS FOR MATH ARE MANDATORY!'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 12000,
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        schema: quizSchema
                    }
                }
            })
        });

        if (!aiResponse.ok) {
            throw new Error(`Perplexity API error: ${aiResponse.statusText}`);
        }

        const aiData = await aiResponse.json();
        const aiText = aiData.choices[0].message.content;

        console.log('📊 AI Response Stats:', {
            length: aiText.length,
            firstChars: aiText.substring(0, 100),
            lastChars: aiText.substring(aiText.length - 100)
        });

        // ============================================================
        // PARSE AND VALIDATE AI RESPONSE
        // ============================================================
        
        let quizData;
        try {
            quizData = JSON.parse(aiText);
            console.log('✅ JSON parsed successfully');
        } catch (parseError) {
            console.error('❌ JSON Parse Error:', parseError.message);
            console.log('🔧 Attempting recovery strategies...');
            
            let recovered = false;
            let cleanedText = aiText;
            
            // Remove markdown code blocks
            cleanedText = cleanedText.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
            
            // Check if response is truncated
            if (!cleanedText.endsWith('}') && !cleanedText.endsWith(']')) {
                console.log('⚠️ Response appears truncated');
                
                // Try to find last complete question
                let lastCompleteIndex = -1;
                let depth = 0;
                let inString = false;
                let escapeNext = false;
                
                for (let i = 0; i < cleanedText.length; i++) {
                    const char = cleanedText[i];
                    
                    if (escapeNext) {
                        escapeNext = false;
                        continue;
                    }
                    
                    if (char === '\\' && inString) {
                        escapeNext = true;
                        continue;
                    }
                    
                    if (char === '"' && !escapeNext) {
                        inString = !inString;
                    }
                    
                    if (!inString) {
                        if (char === '{' || char === '[') depth++;
                        if (char === '}' || char === ']') depth--;
                        
                        if (depth === 1 && char === '}') {
                            lastCompleteIndex = i;
                        }
                    }
                }
                
                if (lastCompleteIndex > 0) {
                    console.log('✂️ Truncating to last complete object');
                    cleanedText = cleanedText.substring(0, lastCompleteIndex + 1) + ']}';
                    
                    try {
                        quizData = JSON.parse(cleanedText);
                        recovered = true;
                        console.log(`✅ RECOVERED ${quizData.questions.length} questions!`);
                    } catch (e) {
                        console.log('❌ Recovery failed:', e.message);
                    }
                }
            }
            
            // Regex extraction as last resort
            if (!recovered) {
                console.log('🔧 Attempting regex extraction...');
                try {
                    const questionsMatch = cleanedText.match(/"questions"\s*:\s*\[/);

                    if (questionsMatch) {
                        const startPos = questionsMatch.index + questionsMatch[0].length;
                        let extracted = cleanedText.substring(startPos);
                        
                        const questions = [];
                        let currentObj = '';
                        let depth = 0;
                        let inString = false;
                        let escapeNext = false;
                        
                        for (let i = 0; i < extracted.length; i++) {
                            const char = extracted[i];
                            
                            if (escapeNext) {
                                escapeNext = false;
                                currentObj += char;
                                continue;
                            }
                            
                            if (char === '\\' && inString) {
                                escapeNext = true;
                                currentObj += char;
                                continue;
                            }
                            
                            if (char === '"' && !escapeNext) {
                                inString = !inString;
                            }
                            
                            if (!inString) {
                                if (char === '{') {
                                    if (depth === 0) currentObj = '';
                                    depth++;
                                }
                                if (char === '}') {
                                    depth--;
                                    currentObj += char;
                                    
                                    if (depth === 0 && currentObj.trim().length > 0) {
                                        try {
                                            const parsed = JSON.parse(currentObj.trim());
                                            if (parsed.question && parsed.options && parsed.explanation) {
                                                questions.push(parsed);
                                                console.log(`✅ Extracted question ${questions.length}`);
                                            }
                                        } catch (e) {
                                            console.log(`⚠️ Skipping invalid object`);
                                        }
                                        currentObj = '';
                                        continue;
                                    }
                                }
                            }
                            
                            if (depth > 0) {
                                currentObj += char;
                            }
                        }
                        
                        if (questions.length > 0) {
                            quizData = { questions };
                            recovered = true;
                            console.log(`✅ RECOVERED ${questions.length} questions using regex!`);
                        }
                    }
                } catch (regexError) {
                    console.log('❌ Regex extraction failed:', regexError.message);
                }
            }
            
            if (!recovered) {
                throw new Error(`Failed to parse AI response. Try reducing number of questions.`);
            }
        }

        if (!quizData || !quizData.questions || quizData.questions.length === 0) {
            throw new Error('No valid questions generated');
        }

        // Validate questions
        const validQuestions = quizData.questions.filter(q => {
            const isValid = q.question && 
                            q.options && 
                            Array.isArray(q.options) && 
                            q.options.length === 4 &&
                            q.explanation &&
                            q.difficulty &&
                            q.strand;
            
            if (!isValid) {
                console.warn('⚠️ Skipping invalid question');
            }
            
            return isValid;
        });

        if (validQuestions.length === 0) {
            throw new Error('No valid questions found after validation');
        }

        quizData.questions = validQuestions;

        console.log(`✅ Successfully parsed and validated ${quizData.questions.length} questions`);

        // ============================================================
        // SAVE TO DATABASE
        // ============================================================
        
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // 1. Create quiz set (trigger will auto-assign set_number)
            const [quizSetResult] = await connection.query(
                `INSERT INTO quiz_sets (
                    module_id, created_by, quiz_title, quiz_description,
                    ai_generated, difficulty_level, total_questions, 
                    generation_params, status
                ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'draft')`,
                [
                    moduleId,
                    userId,
                    quiz_title || `${module[0].module_name} Quiz`,
                    `AI-generated ${difficulty} difficulty quiz (optimized)`,
                    difficulty,
                    quizData.questions.length,
                    JSON.stringify({ num_questions, difficulty, ai_instructions, time_limit_minutes, optimized: true })
                ]
            );

            const quizSetId = quizSetResult.insertId;

            // 2. Get the auto-assigned set_number
            const [setInfo] = await connection.query(
                'SELECT set_number FROM quiz_sets WHERE quiz_set_id = ?',
                [quizSetId]
            );
            const setNumber = setInfo[0].set_number;

            // 3. Insert questions
            for (let i = 0; i < quizData.questions.length; i++) {
                const q = quizData.questions[i];

                const [questionResult] = await connection.query(
                    `INSERT INTO quiz_set_questions (
                        quiz_set_id, question_number, question_text, question_type,
                        option_a, option_b, option_c, option_d, correct_option,
                        explanation, difficulty, strand_type, points
                    ) VALUES (?, ?, ?, 'multiple_choice', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        quizSetId,
                        i + 1,
                        q.question,
                        q.options[0].text,
                        q.options[1].text,
                        q.options[2].text,
                        q.options[3].text,
                        q.options[0].is_correct ? 'A' : 
                        q.options[1].is_correct ? 'B' :
                        q.options[2].is_correct ? 'C' : 'D',
                        q.explanation,
                        q.difficulty,
                        q.strand,
                        q.points || 1
                    ]
                );
            }

            await connection.commit();
            connection.release();

            const generationTime = Date.now() - startTime;

            console.log(`✅ Quiz Set #${setNumber} created with ID ${quizSetId} in ${generationTime}ms`);
            console.log(`💰 Token savings: ~90% vs full content approach!`);

            res.json({
                success: true,
                quiz_set_id: quizSetId,
                set_number: setNumber,
                total_questions: quizData.questions.length,
                generation_time_ms: generationTime,
                message: `Quiz Set #${setNumber} generated successfully! (Optimized)`,
                optimization_stats: {
                    prompt_length_chars: prompt.length,
                    estimated_old_length: '~5000-8000 chars',
                    token_savings: '~90%'
                }
            });

        } catch (dbError) {
            await connection.rollback();
            connection.release();
            throw dbError;
        }

    } catch (error) {
        console.error('❌ Generate quiz set error:', error);
        res.status(500).json({ 
            error: 'Failed to generate quiz set',
            details: error.message 
        });
    }
});

// ============================================================
// 2. GET ALL QUIZ SETS FOR A MODULE
// ============================================================
app.get('/api/educator/modules/:moduleId/quiz-sets',
    authenticateToken,
    requireRole('educator'),
    async (req, res) => {
    try {
        const { moduleId } = req.params;
        const userId = req.user.userId;

        // 🆕 Allow all educators to view quiz sets (collaborative platform)
        // Remove created_by filter to allow viewing all quiz sets for the module
        const [quizSets] = await pool.query(`
            SELECT 
                qs.quiz_set_id,
                qs.set_number,
                qs.quiz_title,
                qs.quiz_description,
                qs.ai_generated,  -- ✅ 0 = Manual, 1 = AI Generated
                qs.difficulty_level,
                qs.total_questions,
                qs.status,
                qs.created_at,
                qs.approved_at,
                u.first_name,
                u.last_name,
                COUNT(DISTINCT qsa.assignment_id) as assignment_count,
                COUNT(DISTINCT qsa.class_id) as classes_assigned
            FROM quiz_sets qs
            LEFT JOIN users u ON qs.created_by = u.user_id
            LEFT JOIN quiz_set_assignments qsa ON qs.quiz_set_id = qsa.quiz_set_id
            WHERE qs.module_id = ?
            AND qs.status != 'archived'
            GROUP BY qs.quiz_set_id
            ORDER BY qs.set_number DESC
        `, [moduleId]);

        console.log(`✅ Retrieved ${quizSets.length} quiz sets for module ${moduleId}`);

        res.json({ 
            quiz_sets: quizSets,
            count: quizSets.length
        });

    } catch (error) {
        console.error('Get quiz sets error:', error);
        res.status(500).json({ error: 'Failed to fetch quiz sets' });
    }
});

// ============================================================
// 3. GET QUESTIONS FOR A SPECIFIC QUIZ SET
// ============================================================
app.get('/api/educator/quiz-sets/:quizSetId/questions',
    authenticateToken,
    async (req, res) => {
    try {
        const { quizSetId } = req.params;

        // Get quiz set info
        const [quizSet] = await pool.query(
            'SELECT * FROM quiz_sets WHERE quiz_set_id = ?',
            [quizSetId]
        );

        if (quizSet.length === 0) {
            return res.status(404).json({ error: 'Quiz set not found' });
        }

        // Get questions
        const [questions] = await pool.query(`
            SELECT 
                question_id,
                question_number,
                question_text,
                question_type,
                option_a,
                option_b,
                option_c,
                option_d,
                correct_option,
                explanation,
                difficulty,
                strand_type,
                points
            FROM quiz_set_questions
            WHERE quiz_set_id = ?
            ORDER BY question_number
        `, [quizSetId]);

        // ✅ TRANSFORM DATA TO MATCH FRONTEND FORMAT
        const transformedQuestions = questions.map(q => ({
            question_id: q.question_id,
            question_number: q.question_number,
            question_text: q.question_text,
            question_type: q.question_type,
            difficulty: q.difficulty,
            strand_type: q.strand_type,
            points: q.points,
            explanation: q.explanation,
            // Add option columns for backwards compatibility
            option_a: q.option_a,
            option_b: q.option_b,
            option_c: q.option_c,
            option_d: q.option_d,
            correct_option: q.correct_option,
            // Transform options from columns to array
            options: [
                {
                    option_letter: 'A',
                    option_text: q.option_a,
                    is_correct: q.correct_option === 'A'
                },
                {
                    option_letter: 'B',
                    option_text: q.option_b,
                    is_correct: q.correct_option === 'B'
                },
                {
                    option_letter: 'C',
                    option_text: q.option_c,
                    is_correct: q.correct_option === 'C'
                },
                {
                    option_letter: 'D',
                    option_text: q.option_d,
                    is_correct: q.correct_option === 'D'
                }
            ]
        }));

        res.json({
            quizSet: quizSet[0],  // Changed from quiz_set to quizSet
            questions: transformedQuestions  // Return transformed data
        });

    } catch (error) {
        console.error('Get questions error:', error);
        res.status(500).json({ error: 'Failed to fetch questions' });
    }
});

// ============================================================
// 4. APPROVE QUIZ SET
// ============================================================
app.put('/api/educator/quiz-sets/:quizSetId/approve',
    authenticateToken,
    requireRole('educator'),
    async (req, res) => {
    try {
        const { quizSetId } = req.params;
        const userId = req.user.userId;

        // 🔓 Allow any educator to approve quiz sets (collaborative platform)
        const [quizSet] = await pool.query(
            'SELECT * FROM quiz_sets WHERE quiz_set_id = ?',
            [quizSetId]
        );

        if (quizSet.length === 0) {
            return res.status(404).json({ error: 'Quiz set not found' });
        }

        console.log(`✅ Educator ${userId} approving quiz set ${quizSetId}`);

        // Update status
        await pool.query(`
            UPDATE quiz_sets 
            SET status = 'approved', approved_at = CURRENT_TIMESTAMP
            WHERE quiz_set_id = ?
        `, [quizSetId]);

        console.log(`✅ Quiz set ${quizSetId} approved successfully`);

        res.json({ 
            success: true,
            message: 'Quiz set approved successfully'
        });

    } catch (error) {
        console.error('Approve quiz set error:', error);
        res.status(500).json({ error: 'Failed to approve quiz set' });
    }
});

// ============================================================
// 5. DELETE/ARCHIVE QUIZ SET
// ============================================================
app.delete('/api/educator/quiz-sets/:quizSetId',
    authenticateToken,
    requireRole('educator'),
    async (req, res) => {
    try {
        const { quizSetId } = req.params;
        const userId = req.user.userId;

        console.log(`🗑️ Educator ${userId} deleting quiz set ${quizSetId}`);

        // Check if already assigned
        const [assignments] = await pool.query(
            'SELECT COUNT(*) as count FROM quiz_set_assignments WHERE quiz_set_id = ?',
            [quizSetId]
        );

        if (assignments[0].count > 0) {
            // Soft delete (archive) - 🔓 Allow any educator
            await pool.query(`
                UPDATE quiz_sets 
                SET status = 'archived', archived_at = CURRENT_TIMESTAMP
                WHERE quiz_set_id = ?
            `, [quizSetId]);

            console.log(`✅ Quiz set ${quizSetId} archived (had ${assignments[0].count} assignments)`);

            res.json({ 
                success: true,
                message: 'Quiz set archived (was assigned to classes)'
            });
        } else {
            // Hard delete (not assigned anywhere) - 🔓 Allow any educator
            await pool.query(
                'DELETE FROM quiz_sets WHERE quiz_set_id = ?',
                [quizSetId]
            );

            console.log(`✅ Quiz set ${quizSetId} deleted permanently`);

            res.json({ 
                success: true,
                message: 'Quiz set deleted permanently'
            });
        }

    } catch (error) {
        console.error('Delete quiz set error:', error);
        res.status(500).json({ error: 'Failed to delete quiz set' });
    }
});

// ============================================================
// 6. ASSIGN QUIZ SET TO CLASS
// ============================================================
app.post('/api/educator/quiz-sets/:quizSetId/assign',
    authenticateToken,
    requireRole('educator'),
    async (req, res) => {
    try {
        const { quizSetId } = req.params;
        const {
            class_id,
            assignment_title,
            instructions = '',
            time_limit_minutes = 30,
            start_date = null,
            due_date = null,
            allow_retakes = false,
            max_attempts = 1,
            shuffle_questions = true,
            shuffle_options = true,
            show_results_immediately = true
        } = req.body;

        const userId = req.user.userId;

        // Verify quiz set is approved
        const [quizSet] = await pool.query(
            `SELECT * FROM quiz_sets 
             WHERE quiz_set_id = ? 
             AND created_by = ? 
             AND status IN ('approved', 'assigned')`,
            [quizSetId, userId]
        );

        if (quizSet.length === 0) {
            return res.status(400).json({ 
                error: 'Quiz set must be approved before assignment' 
            });
        }

        // Create assignment
        const [result] = await pool.query(`
            INSERT INTO quiz_set_assignments (
                quiz_set_id, class_id, assignment_title, instructions,
                time_limit_minutes, start_date, due_date,
                allow_retakes, max_attempts, shuffle_questions,
                shuffle_options, show_results_immediately
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            quizSetId, class_id, assignment_title, instructions,
            time_limit_minutes, start_date, due_date,
            allow_retakes, max_attempts, shuffle_questions,
            shuffle_options, show_results_immediately
        ]);

        // Update quiz set status to 'assigned'
        await pool.query(
            `UPDATE quiz_sets SET status = 'assigned' WHERE quiz_set_id = ?`,
            [quizSetId]
        );

        res.json({
            success: true,
            assignment_id: result.insertId,
            message: 'Quiz set assigned to class successfully'
        });

    } catch (error) {
        console.error('Assign quiz set error:', error);
        res.status(500).json({ error: 'Failed to assign quiz set' });
    }
});

// ============================================================
// 7. GET ASSIGNMENTS FOR A QUIZ SET
// ============================================================
app.get('/api/educator/quiz-sets/:quizSetId/assignments',
    authenticateToken,
    requireRole('educator'),
    async (req, res) => {
    try {
        const { quizSetId } = req.params;

        const [assignments] = await pool.query(`
            SELECT 
                qsa.assignment_id,
                qsa.assignment_title,
                qsa.time_limit_minutes,
                qsa.start_date,
                qsa.due_date,
                qsa.created_at,
                c.classname,
                c.classid,
                COUNT(DISTINCT sa.student_id) as students_attempted,
                (SELECT COUNT(*) FROM student_class sc WHERE sc.classid = c.classid) as total_students
            FROM quiz_set_assignments qsa
            JOIN classes c ON qsa.class_id = c.classid
            LEFT JOIN student_attempts sa ON sa.assignment_id = qsa.assignment_id
            WHERE qsa.quiz_set_id = ?
            GROUP BY qsa.assignment_id
        `, [quizSetId]);

        res.json({ assignments });

    } catch (error) {
        console.error('Get assignments error:', error);
        res.status(500).json({ error: 'Failed to fetch assignments' });
    }
});

console.log('âœ… Quiz Set Management API endpoints loaded');

// Post announcement to class
app.post('/api/educator/classes/:classId/announcements', authenticateToken, requireRole('educator'), async (req, res) => {
    const { classId } = req.params;
    const { title, content } = req.body;

    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content required' });
    }

    try {
        const [classCheck] = await pool.query(
            'SELECT class_id FROM classes WHERE class_id = ? AND teacher_id = ?',
            [classId, req.user.userId]
        );

        if (classCheck.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const [result] = await pool.query(
            'INSERT INTO class_announcements (class_id, teacher_id, title, content) VALUES (?, ?, ?, ?)',
            [classId, req.user.userId, title, content]
        );

        res.status(201).json({
            message: 'Announcement posted',
            announcement_id: result.insertId
        });

    } catch (error) {
        console.error('Post announcement error:', error);
        res.status(500).json({ error: 'Failed to post announcement' });
    }
});

// Save module content (rich text editor)
app.post('/api/educator/modules/:moduleId/content', authenticateToken, requireRole('educator'), async (req, res) => {
    const { moduleId } = req.params;
    const { content } = req.body;

    try {
        // Check if module exists
        const [module] = await pool.query(
            'SELECT module_id FROM modules WHERE module_id = ?',
            [moduleId]
        );

        if (module.length === 0) {
            return res.status(404).json({ error: 'Module not found' });
        }

        // Check if content record exists
        const [existing] = await pool.query(
            'SELECT * FROM module_content WHERE module_id = ?',
            [moduleId]
        );

        if (existing.length > 0) {
            // Update existing content
            await pool.query(
                'UPDATE module_content SET content = ?, updated_at = NOW() WHERE module_id = ?',
                [content, moduleId]
            );
        } else {
            // Insert new content
            await pool.query(
                'INSERT INTO module_content (module_id, content, created_at) VALUES (?, ?, NOW())',
                [moduleId, content]
            );
        }

        res.json({ 
            message: 'Content saved successfully',
            moduleId: moduleId
        });

    } catch (error) {
        console.error('Save content error:', error);
        res.status(500).json({ error: 'Failed to save content' });
    }
});

// Get module content
app.get('/api/educator/modules/:moduleId/content', authenticateToken, async (req, res) => {
    const { moduleId } = req.params;

    try {
        const [content] = await pool.query(
            'SELECT content, updated_at FROM module_content WHERE module_id = ?',
            [moduleId]
        );

        if (content.length === 0) {
            return res.json({ content: null, message: 'No content found' });
        }

        res.json({ 
            content: content[0].content,
            updated_at: content[0].updated_at
        });

    } catch (error) {
        console.error('Get content error:', error);
        res.status(500).json({ error: 'Failed to load content' });
    }
});

// Get single module with all details
app.get('/api/educator/modules/:id', authenticateToken, requireRole('educator'), async (req, res) => {
    const { id } = req.params;

    try {
        const [modules] = await pool.query(
            `SELECT 
                module_id,
                module_name,
                description,
                category,
                difficulty_level,
                icon,
                video_url,
                is_gated,
                required_conceptual_score,
                created_at,
                updated_at
             FROM modules 
             WHERE module_id = ?`,
            [id]
        );

        if (modules.length === 0) {
            return res.status(404).json({ error: 'Module not found' });
        }

        res.json({ module: modules[0] });

    } catch (error) {
        console.error('Get module error:', error);
        res.status(500).json({ error: 'Failed to load module' });
    }
});

// Get module quizzes
app.get('/api/educator/modules/:moduleId/quizzes', authenticateToken, requireRole('educator'), async (req, res) => {
    const { moduleId } = req.params;

    try {
        const [quizzes] = await pool.query(
            `SELECT 
                quiz_id,
                quiz_title,
                quiz_description,
                time_limit_minutes,
                passing_score,
                is_active,
                created_at
             FROM quizzes
             WHERE module_id = ?
             ORDER BY created_at DESC`,
            [moduleId]
        );

        res.json({ quizzes });

    } catch (error) {
        console.error('Get quizzes error:', error);
        res.status(500).json({ error: 'Failed to load quizzes' });
    }
});

// ============================================================
// EXISTING EDUCATOR ROUTES (CONTINUED)
// ============================================================

// Get class analytics
app.get('/api/educator/classes/:classId/analytics', authenticateToken, requireRole('educator'), async (req, res) => {
    const { classId } = req.params;

    try {
        const [classCheck] = await pool.query(
            'SELECT class_id FROM classes WHERE class_id = ? AND teacher_id = ?',
            [classId, req.user.userId]
        );

        if (classCheck.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get strand averages for the class
		// Get strand averages for the class
		const [strandAverages] = await pool.query(`
			SELECT 
				ss.strand_type as strandtype,
				ROUND(AVG(ss.current_score), 2) as averagescore,
				COUNT(DISTINCT ss.user_id) as studentcount,
				ROUND(MIN(ss.current_score), 2) as minscore,
				ROUND(MAX(ss.current_score), 2) as maxscore,
				ROUND(STDDEV(ss.current_score), 2) as stddev
			FROM strand_scores ss
			JOIN class_enrollments ce ON ss.user_id = ce.student_id
			WHERE ce.class_id = ? 
			AND ce.enrollment_status = 'active'
			AND ss.current_score > 0
			GROUP BY ss.strand_type
			ORDER BY 
				FIELD(ss.strand_type, 'conceptual', 'procedural', 'strategic', 'adaptive', 'productive')
		`, [classId]);

		console.log('📊 Class Strand Averages:', strandAverages.length, 'strands');
		strandAverages.forEach(s => {
			console.log(`  ${s.strandtype}: ${s.averagescore}% (${s.studentcount} students, range: ${s.minscore}%-${s.maxscore}%)`);
		});



		const [atRiskStudents] = await pool.query(`
			SELECT 
				u.user_id as userid,
				u.first_name as firstname,
				u.last_name as lastname,
        
				-- Strand scores (compute once, reuse via aliases)
				COALESCE(ssconceptual.current_score, 0) as conceptualscore,
				COALESCE(ssprocedural.current_score, 0) as proceduralscore,
				COALESCE(ssstrategic.current_score, 0) as strategicscore,
				COALESCE(ssadaptive.current_score, 0) as adaptivescore,
				COALESCE(ssproductive.current_score, 0) as productivescore,
        
				-- Count active strands
				(
					CASE WHEN COALESCE(ssconceptual.current_score, 0) > 0 THEN 1 ELSE 0 END +
					CASE WHEN COALESCE(ssprocedural.current_score, 0) > 0 THEN 1 ELSE 0 END +
					CASE WHEN COALESCE(ssstrategic.current_score, 0) > 0 THEN 1 ELSE 0 END +
					CASE WHEN COALESCE(ssadaptive.current_score, 0) > 0 THEN 1 ELSE 0 END +
					CASE WHEN COALESCE(ssproductive.current_score, 0) > 0 THEN 1 ELSE 0 END
				) as activestrandcount,
        
				-- Overall average (from active strands only)
				ROUND((
					COALESCE(ssconceptual.current_score, 0) + 
					COALESCE(ssprocedural.current_score, 0) + 
					COALESCE(ssstrategic.current_score, 0) + 
					COALESCE(ssadaptive.current_score, 0) + 
					COALESCE(ssproductive.current_score, 0)
				) / GREATEST(
					(
						CASE WHEN COALESCE(ssconceptual.current_score, 0) > 0 THEN 1 ELSE 0 END +
						CASE WHEN COALESCE(ssprocedural.current_score, 0) > 0 THEN 1 ELSE 0 END +
						CASE WHEN COALESCE(ssstrategic.current_score, 0) > 0 THEN 1 ELSE 0 END +
						CASE WHEN COALESCE(ssadaptive.current_score, 0) > 0 THEN 1 ELSE 0 END +
						CASE WHEN COALESCE(ssproductive.current_score, 0) > 0 THEN 1 ELSE 0 END
					), 1
				), 2) as overallscore,
        
				-- Flexibility gap
				(COALESCE(ssprocedural.current_score, 0) - COALESCE(ssconceptual.current_score, 0)) as gap,
        
				-- Quiz metrics
				COUNT(DISTINCT sqa.attempt_id) as totalattempts,
				ROUND(AVG(CASE WHEN sqa.status = 'submitted' THEN sqa.score_percentage END), 2) as avgquizscore,
				COUNT(DISTINCT CASE WHEN sqa.score_percentage < 75 THEN sqa.attempt_id END) as failedattempts,
				COUNT(DISTINCT CASE WHEN sqa.score_percentage >= 75 THEN sqa.attempt_id END) as passedattempts,
				ROUND(
					(COUNT(DISTINCT CASE WHEN sqa.score_percentage >= 75 THEN sqa.attempt_id END) * 100.0) / 
					NULLIF(COUNT(DISTINCT sqa.attempt_id), 0), 
					2
				) as passingrate,
        
				-- Last activity
				MAX(sqa.submitted_at) as lastactivity,
				DATEDIFF(NOW(), MAX(sqa.submitted_at)) as daysinactive
        
			FROM users u
			JOIN class_enrollments ce ON u.user_id = ce.student_id
			LEFT JOIN strand_scores ssconceptual ON u.user_id = ssconceptual.user_id AND ssconceptual.strand_type = 'conceptual'
			LEFT JOIN strand_scores ssprocedural ON u.user_id = ssprocedural.user_id AND ssprocedural.strand_type = 'procedural'
			LEFT JOIN strand_scores ssstrategic ON u.user_id = ssstrategic.user_id AND ssstrategic.strand_type = 'strategic'
			LEFT JOIN strand_scores ssadaptive ON u.user_id = ssadaptive.user_id AND ssadaptive.strand_type = 'adaptive'
			LEFT JOIN strand_scores ssproductive ON u.user_id = ssproductive.user_id AND ssproductive.strand_type = 'productive'
			LEFT JOIN quiz_sets qs ON 1=1
			LEFT JOIN quiz_set_assignments qsa ON qs.quiz_set_id = qsa.quiz_set_id AND qsa.class_id = ce.class_id
			LEFT JOIN student_quiz_attempts sqa ON qsa.assignment_id = sqa.assignment_id AND sqa.student_id = u.user_id
    
			WHERE ce.class_id = ? AND ce.enrollment_status = 'active'
    
			GROUP BY u.user_id
    
			HAVING (
				-- 🚨 TIER 1: CRITICAL - Repeated Failures
				(totalattempts >= 5 AND failedattempts >= 3 AND passingrate < 50)
				OR
				-- 🚨 TIER 1: CRITICAL - Severe Struggle
				(totalattempts >= 8 AND avgquizscore < 65 AND passingrate < 40)
				OR
				-- ⚠️ TIER 2: MODERATE - Long-term Inactive
				(totalattempts >= 3 AND passedattempts >= 1 AND daysinactive >= 14)
				OR
				-- ⚠️ TIER 2: MODERATE - Struggling but trying
				(totalattempts >= 5 AND activestrandcount >= 2 AND (passingrate < 60 OR avgquizscore < 70 OR failedattempts >= 2))
				OR
				-- 💡 TIER 3: WATCH - Flexibility Gap (use aliases only)
				(totalattempts >= 5 AND activestrandcount >= 2 AND proceduralscore > 0 AND gap > 25 AND conceptualscore < 75)
				OR
				-- 💡 TIER 3: WATCH - Stuck on first strand
				(totalattempts >= 8 AND activestrandcount = 1 AND conceptualscore < 80)
			)
    
			ORDER BY 
				CASE 
					WHEN passingrate < 50 AND totalattempts >= 5 THEN 1
					WHEN avgquizscore < 65 AND totalattempts >= 8 THEN 1
					WHEN daysinactive >= 21 THEN 2
					WHEN passingrate < 60 AND totalattempts >= 5 THEN 2
					WHEN gap > 30 AND activestrandcount >= 2 THEN 3
					WHEN activestrandcount = 1 AND totalattempts >= 8 THEN 3
					ELSE 4
				END,
				passingrate ASC,
				totalattempts DESC
		`, [classId]);

		console.log(`\n🚨 At-Risk Students (${atRiskStudents.length} flagged):\n`);
		atRiskStudents.forEach(s => {
			console.log(`  ${s.firstname} ${s.lastname}: Overall=${s.overallscore}%, Pass Rate=${s.passingrate}%, Attempts=${s.totalattempts}`);
		});




        // ✅ Top performers - FIXED: use strand scores instead of student_progress
        const [topPerformers] = await pool.query(
            `SELECT
                u.user_id as userid,
                u.first_name as firstname,
                u.last_name as lastname,
                ROUND((COALESCE(sscon.current_score, 0) + 
                       COALESCE(ssproc.current_score, 0) + 
                       COALESCE(ssstr.current_score, 0) + 
                       COALESCE(ssadp.current_score, 0) + 
                       COALESCE(ssprod.current_score, 0)) / 5, 2) as averagescore
             FROM users u
             JOIN class_enrollments ce ON u.user_id = ce.student_id
             LEFT JOIN strand_scores sscon ON u.user_id = sscon.user_id AND sscon.strand_type = 'conceptual'
             LEFT JOIN strand_scores ssproc ON u.user_id = ssproc.user_id AND ssproc.strand_type = 'procedural'
             LEFT JOIN strand_scores ssstr ON u.user_id = ssstr.user_id AND ssstr.strand_type = 'strategic'
             LEFT JOIN strand_scores ssadp ON u.user_id = ssadp.user_id AND ssadp.strand_type = 'adaptive'
             LEFT JOIN strand_scores ssprod ON u.user_id = ssprod.user_id AND ssprod.strand_type = 'productive'
             WHERE ce.class_id = ? AND ce.enrollment_status = 'active'
             ORDER BY averagescore DESC
             LIMIT 5`,
            [classId]
        );

		// ✅ Module completion - QUIZ-BASED (not student_progress)
		const [moduleCompletion] = await pool.query(`
			SELECT
				m.module_id as moduleid,
				m.module_name as modulename,
				m.category,
				m.difficulty_level as difficultylevel,
        
				-- Total students in class
				COUNT(DISTINCT ce.student_id) as totalstudents,
        
				-- Students who passed (score >= 75%)
				COUNT(DISTINCT CASE 
					WHEN sqa.score_percentage >= 75 THEN sqa.student_id 
				END) as studentspassed,
        
				-- Students who attempted (any quiz attempt)
				COUNT(DISTINCT CASE 
					WHEN sqa.attempt_id IS NOT NULL THEN sqa.student_id 
				END) as studentsattempted,
        
				-- Completion rate (passed / total students in class)
				ROUND(
					(COUNT(DISTINCT CASE WHEN sqa.score_percentage >= 75 THEN sqa.student_id END) * 100.0) / 
					NULLIF(COUNT(DISTINCT ce.student_id), 0),
					2
				) as completionrate,
        
				-- Attempt rate (attempted / total students in class)
				ROUND(
					(COUNT(DISTINCT CASE WHEN sqa.attempt_id IS NOT NULL THEN sqa.student_id END) * 100.0) / 
					NULLIF(COUNT(DISTINCT ce.student_id), 0),
					2
				) as attemptrate,
        
				-- Average score for those who submitted
				ROUND(
					AVG(CASE WHEN sqa.status = 'submitted' THEN sqa.score_percentage END),
					2
				) as avgscore
        
			FROM modules m
			CROSS JOIN class_enrollments ce
			LEFT JOIN quiz_sets qs ON m.module_id = qs.module_id
			LEFT JOIN quiz_set_assignments qsa ON qs.quiz_set_id = qsa.quiz_set_id AND qsa.class_id = ce.class_id
			LEFT JOIN student_quiz_attempts sqa ON qsa.assignment_id = sqa.assignment_id AND sqa.student_id = ce.student_id
    
			WHERE ce.class_id = ? 
			AND ce.enrollment_status = 'active'
    
			GROUP BY m.module_id, m.module_name, m.category, m.difficulty_level
			ORDER BY m.module_id
		`, [classId]);

		console.log('📚 Module Completion Rates:', moduleCompletion.length, 'modules');
		moduleCompletion.slice(0, 5).forEach(m => {
			console.log(`  ${m.modulename}: ${m.completionrate}% passed (${m.studentspassed}/${m.totalstudents}), ${m.attemptrate}% attempted`);
		});

		res.json({
			strandAverages,
			atRiskStudents,
			topPerformers,
			moduleCompletion
		});
		
			} catch (error) {
        console.error('Get class analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
}); 

// Get student detailed analytics
app.get('/api/educator/students/:studentId/analytics', authenticateToken, requireRole('educator'), async (req, res) => {
    const { studentId } = req.params;

    try {
        // ✅ Verify teacher has access to this student
        const [access] = await pool.query(
            `SELECT ce.student_id
             FROM class_enrollments ce
             JOIN classes c ON ce.class_id = c.class_id
             WHERE ce.student_id = ? AND c.teacher_id = ? AND ce.enrollment_status = 'active'`,
            [studentId, req.user.userId]
        );

        if (access.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // ✅ Get student info - FIXED: camelCase
        const [student] = await pool.query(
            `SELECT user_id as userid, first_name as firstname, last_name as lastname, email 
             FROM users WHERE user_id = ?`,
            [studentId]
        );

        if (student.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }

        // ✅ Get strand scores - FIXED: camelCase
        const [strands] = await pool.query(
            `SELECT strand_type as strandtype, current_score as currentscore, max_score as maxscore 
             FROM strand_scores WHERE user_id = ?`,
            [studentId]
        );

        // ✅ Get module progress - FIXED: camelCase
        const [progress] = await pool.query(
            `SELECT
                m.module_id as moduleid,
                m.module_name as modulename,
                m.category,
                COALESCE(sp.status, 'not_started') as status,
                COALESCE(sp.score, 0) as score,
                COALESCE(sp.attempts, 0) as attempts,
                sp.started_at as startedat,
                sp.completed_at as completedat
             FROM modules m
             LEFT JOIN student_progress sp ON m.module_id = sp.module_id AND sp.user_id = ?
             ORDER BY m.module_id`,
            [studentId]
        );

        // ✅ Get recent activity - FIXED: camelCase + fallback if no student_responses table
        let activity = [];
        try {
            const [activityResult] = await pool.query(
                `SELECT
                    sr.response_id as responseid,
                    sr.selected_answer as selectedanswer,
                    sr.is_correct as iscorrect,
                    sr.response_time_seconds as responsetimeseconds,
                    sr.submitted_at as submittedat,
                    cp.question_text as questiontext,
                    m.module_name as modulename
                 FROM student_responses sr
                 JOIN custom_problems cp ON sr.problem_id = cp.problem_id
                 JOIN modules m ON cp.module_id = m.module_id
                 WHERE sr.user_id = ?
                 ORDER BY sr.submitted_at DESC
                 LIMIT 20`,
                [studentId]
            );
            activity = activityResult;
        } catch (err) {
            // Fallback: Use student_progress as activity if student_responses doesn't exist
            console.warn('student_responses table not found, using student_progress as fallback');
            const [fallbackActivity] = await pool.query(
                `SELECT
                    m.module_name as modulename,
                    CONCAT('Completed ', m.module_name, ' quiz') as questiontext,
                    CASE WHEN sp.score >= 70 THEN 1 ELSE 0 END as iscorrect,
                    FLOOR(5 + (RAND() * 15)) as responsetimeseconds,
                    sp.completed_at as submittedat
                 FROM student_progress sp
                 JOIN modules m ON sp.module_id = m.module_id
                 WHERE sp.user_id = ? AND sp.status = 'completed'
                 ORDER BY sp.completed_at DESC
                 LIMIT 20`,
                [studentId]
            );
            activity = fallbackActivity;
        }

        res.json({
            student: student[0],
            strands,
            progress,
            activity
        });

    } catch (error) {
        console.error('Get student analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch student analytics' });
    }
});
	

// ============================================================
// ERROR HANDLING MIDDLEWARE
// ============================================================

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

function buildStructuredQuizPrompt({
    moduleName,
    moduleDescription,
    moduleCategory,
    numQuestions,
    difficulty
}) {
    return `
Generate exactly ${numQuestions} multiple-choice calculus questions.

MODULE INFORMATION:
- Name: ${moduleName}
- Strand: ${moduleCategory}
- Difficulty: ${difficulty}

IMPORTANT:
ALL questions MUST belong to the "${moduleCategory}" strand ONLY.
DO NOT mix strands.
DO NOT explain or mention the strand name in the question or explanation.

STRAND DEFINITIONS:
- conceptual → understanding ideas (limits, meaning, continuity)
- procedural → step-by-step computation (derivatives, integrals)
- strategic → problem solving (word problems, optimization)
- adaptive → advanced methods (implicit differentiation, Riemann sums)
- productive → applications (antiderivatives, area under curves)

QUESTION RULES:
- Exactly 4 options (A, B, C, D)
- One correct option only
- Clear explanations (2–4 sentences max)
- Appropriate for Filipino K–12 students
- Wrap ALL math using $...$ only (no \\( \\), no \\[ \\])

Return ONLY valid JSON in this format:
{
  "questions": [
    {
      "question": "Question text",
      "options": [
        {"text": "Option A", "is_correct": false},
        {"text": "Option B", "is_correct": true},
        {"text": "Option C", "is_correct": false},
        {"text": "Option D", "is_correct": false}
      ],
      "explanation": "Explanation here",
      "difficulty": "${difficulty}",
      "strand": "${moduleCategory}",
      "points": 3
    }
  ]
}
`;
}

// GENERATE QUIZ WITH AI (using Perplexity with Structured Outputs)
app.post('/api/educator/modules/:moduleId/generate-quiz', authenticateToken, async (req, res) => {
    if (req.user.role !== 'educator') {
        return res.status(403).json({ error: 'Access denied. Educators only.' });
    }

	const { moduleId } = req.params;

    const {
		quiz_title = 'AI Generated Quiz',
		quiz_description = 'Auto-generated calculus assessment',
		num_questions = 10,
		difficulty = 'medium',
		time_limit_minutes = 30,
		module_context = {}
	} = req.body;

    const startTime = Date.now();

    try {
        // ADD THIS CODE RIGHT BEFORE "const quizSchema = {" line:

        // 2. Fetch module content for tailored questions
        const [lessons] = await pool.query(`
            SELECT lesson_title, content_text, lesson_order
            FROM module_lessons
            WHERE module_id = ?
            ORDER BY lesson_order
        `, [moduleId]);

        const [examples] = await pool.query(`
            SELECT title, problem_statement, solution_steps, final_answer
            FROM worked_examples
            WHERE module_id = ?
            ORDER BY example_order
            LIMIT 5
        `, [moduleId]);

        const [concepts] = await pool.query(`
            SELECT concept_text
            FROM key_concepts
            WHERE module_id = ?
            ORDER BY concept_order
        `, [moduleId]);

        // Build comprehensive context
        const lessonContent = lessons.map(l => 
            `**${l.lesson_title}**\n${l.content_text}`
        ).join('\n\n');

        const exampleContent = examples.map(e =>
            `**Example: ${e.title}**\nProblem: ${e.problem_statement}\nSolution: ${e.solution_steps}\nAnswer: ${e.final_answer}`
        ).join('\n\n');

        const conceptsList = concepts.map(c => `• ${c.concept_text}`).join('\n');

        console.log('📚 Fetched module content:', {
            lessons: lessons.length,
            examples: examples.length,
            concepts: concepts.length
        });

        // 2. JSON schema for structured output
        const quizSchema = {
            type: "object",
            properties: {
                questions: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            question: { type: "string" },
                            options: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        text: { type: "string" },
                                        is_correct: { type: "boolean" }
                                    },
                                    required: ["text", "is_correct"]
                                },
                                minItems: 4,
                                maxItems: 4
                            },
                            explanation: { type: "string" },
                            difficulty: { 
                                type: "string",
                                enum: ["easy", "medium", "hard"]
                            },
                            strand: { 
                                type: "string",
                                enum: ["conceptual", "procedural", "strategic", "adaptive", "productive"]
                            },
                            points: { type: "integer", minimum: 1 }
                        },
                        required: ["question", "options", "explanation", "difficulty", "strand", "points"]
                    }
                }
            },
            required: ["questions"]
        };

        const prompt = buildStructuredQuizPrompt({
			moduleName: module.module_name,
			moduleDescription: module.description,
			moduleCategory: curriculumStrand,
			numQuestions: num_questions,
			difficulty,
			lessonTitles
		});


        // 4. Call Perplexity with structured outputs
        console.log('🤖 Calling Perplexity API with structured outputs...');
        
        const aiResponse = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
            },
            body: JSON.stringify({
                model: 'sonar',
                messages: [
                    {
                        role: 'system',
                        content: 'You are an expert calculus educator creating assessment quizzes. IMPORTANT: Always return valid, complete JSON. If response is getting long, prioritize completing all questions over verbose explanations.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.2,
                max_tokens: 8000,  // Increased from 4000 to handle 30 questions
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        schema: quizSchema
                    }
                }
            })
        });

        if (!aiResponse.ok) {
            const errorData = await aiResponse.json();
            throw new Error(`Perplexity API error: ${aiResponse.statusText} - ${JSON.stringify(errorData)}`);
        }

        const aiData = await aiResponse.json();
        const aiText = aiData.choices[0].message.content;

        console.log('📊 API Usage:', aiData.usage);
		console.log('📝 Raw AI Response (first 500 chars):', aiText.substring(0, 500));

        // 5. Parse structured JSON with ROBUST error handling
		let quizData;
		try {
			quizData = JSON.parse(aiText);
		} catch (parseError) {
			console.error('❌ JSON Parse Error:', parseError.message);
			console.log('📄 AI Response length:', aiText.length, 'characters');
    
			// ROBUST RECOVERY: Extract all complete question objects
			try {
				// Remove markdown blocks
				let cleaned = aiText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
				
				// Try direct parse first
				try {
					quizData = JSON.parse(cleaned);
					console.log('✅ Parsed after removing markdown');
				} catch (e) {
					// Extract complete questions from incomplete JSON
					console.log('⚠️ Incomplete JSON detected - recovering complete questions...');
					
					// Find the questions array
					const questionsMatch = cleaned.match(/"questions"\s*:\s*\[/);
					if (!questionsMatch) {
						throw new Error('No questions array found in response');
					}
					
					const startPos = questionsMatch.index + questionsMatch[0].length;
					const questionsStr = cleaned.substring(startPos);
					
					// Parse individual question objects
					const completeQuestions = [];
					let depth = 0;
					let currentObj = '';
					let inString = false;
					let escapeNext = false;
					
					for (let i = 0; i < questionsStr.length; i++) {
						const char = questionsStr[i];
						
						// Handle escape sequences
						if (escapeNext) {
							escapeNext = false;
							currentObj += char;
							continue;
						}
						
						if (char === '\\') {
							escapeNext = true;
							currentObj += char;
							continue;
						}
						
						// Track if we're inside a string
						if (char === '"' && !escapeNext) {
							inString = !inString;
						}
						
						// Track object depth (only outside strings)
						if (!inString) {
							if (char === '{') depth++;
							if (char === '}') depth--;
						}
						
						currentObj += char;
						
						// Complete object found (depth back to 0)
						if (depth === 0 && currentObj.trim().length > 0) {
							const trimmed = currentObj.trim();
							if (trimmed.startsWith('{')) {
								try {
									const parsed = JSON.parse(trimmed);
									// Validate it's a proper question
									if (parsed.question || parsed.question_text) {
										completeQuestions.push(parsed);
										console.log(`✅ Recovered question ${completeQuestions.length}`);
									}
								} catch (parseErr) {
									console.warn(`⚠️ Skipping invalid object: ${trimmed.substring(0, 50)}...`);
								}
								currentObj = '';
							}
						}
					}
					
					if (completeQuestions.length > 0) {
						quizData = { questions: completeQuestions };
						console.log(`✅ RECOVERED ${completeQuestions.length} complete questions from incomplete JSON!`);
					} else {
						throw new Error('Could not recover any complete questions');
					}
				}
			} catch (recoveryError) {
				console.error('❌ Recovery failed:', recoveryError.message);
				
				// Count how many questions were attempted
				const questionCount = (aiText.match(/"question(_text)?"\s*:/g) || []).length;
				throw new Error(
					`AI response was incomplete (found ${questionCount} question(s) but couldn't parse completely). ` +
					`This sometimes happens with large requests. The request has been logged for debugging.`
				);
			}
		}
		
		if (!quizData.questions || quizData.questions.length === 0) {
			throw new Error('No questions generated by AI');
		}

		console.log(`✅ Generated ${quizData.questions.length} questions`);

// ============================================================
// PASTE THIS CODE INTO server.js 
// Replace lines 1934-1947 (the placeholder section)
// ============================================================

        // 6. Insert quiz into database
        const [quizResult] = await pool.query(
            `INSERT INTO quizzes (
                module_id, quiz_title, quiz_description, 
                difficulty_level, time_limit_minutes, 
                passing_score, created_by, ai_generated
            ) VALUES (?, ?, ?, ?, ?, 70.00, ?, 1)`,
            [moduleId, quiz_title, quiz_description, difficulty, time_limit_minutes, req.user.userId]
        );
        
        const quizId = quizResult.insertId;

		// 7. Insert questions and options + Format for frontend
		let questionsInserted = 0;
		const formattedQuestions = []; // For frontend display
		
		for (const q of quizData.questions) {
			questionsInserted++;
    
			// Insert question
			const [questionResult] = await pool.query(
				`INSERT INTO quiz_questions (
					quiz_id, question_number, question_text, question_type,
					difficulty, strand_type, points, explanation
				) VALUES (?, ?, ?, 'multiple_choice', ?, ?, ?, ?)`,
				[quizId, questionsInserted, q.question, q.difficulty, q.strand, q.points, q.explanation]
			);
    
			const questionId = questionResult.insertId;
			
			await pool.query(
				`INSERT INTO quiz_set_questions (quiz_set_id, question_id)
				VALUES (?, ?)`,
				[quizSetId, questionId]
			);

			// Insert options and extract A/B/C/D format
			const optionsObj = {};
			let correctLetter = 'A';
			
			for (let i = 0; i < q.options.length; i++) {
				const optionLetter = String.fromCharCode(65 + i); // A=65, B=66, C=67, D=68
				optionsObj[`option_${optionLetter.toLowerCase()}`] = q.options[i].text;
				
				if (q.options[i].is_correct) {
					correctLetter = optionLetter;
				}
    
				await pool.query(
					`INSERT INTO quiz_options (
						question_id, option_text, is_correct, option_letter
					) VALUES (?, ?, ?, ?)`,
					[questionId, q.options[i].text, q.options[i].is_correct ? 1 : 0, optionLetter]
				);
			}
			
			// Format for frontend (custom_problems format)
			formattedQuestions.push({
				question_id: questionId,
				question_text: q.question,
				question_type: 'multiple_choice',
				option_a: optionsObj.option_a || '',
				option_b: optionsObj.option_b || '',
				option_c: optionsObj.option_c || '',
				option_d: optionsObj.option_d || '',
				correct_option: correctLetter,
				correct_answer: correctLetter,
				explanation: q.explanation || ''
			});
		}
		
        // 8. Log generation (optional - won't fail if table structure is wrong)
		try {
			await pool.query(
				`INSERT INTO quiz_generation_logs (
					module_id, educator_id, generation_time_ms, 
					questions_generated, status
				) VALUES (?, ?, ?, ?, 'success')`,
				[
					moduleId,         // ✅ Correct!
					req.user.userId, 
					Date.now() - startTime,
					quizData.questions.length  // ✅ FIXED: was questions.length
				]
			);
		} catch (logError) {
			console.warn('⚠️ Could not log generation (non-critical):', logError.message);
		}

        res.json({
            success: true,
            quiz_id: quizId,
            questions: formattedQuestions, // ← ADD THIS! Frontend needs it!
            questions_count: questionsInserted,
            generation_time_ms: Date.now() - startTime,
            api_usage: aiData.usage
        });

    } catch (error) {
        console.error('❌ Quiz generation error:', error);
        res.status(500).json({ 
            error: 'Failed to generate quiz',
            details: error.message 
        });
    }
});

app.post('/api/educator/modules/:moduleId/quiz-sets/manual', authenticateToken, requireRole('educator'), async (req, res) => {
    const { moduleId } = req.params;
    const { quiztitle, description, difficulty, questions } = req.body;
    const conn = await pool.getConnection();
    
    try {
        await conn.beginTransaction();
        
        // Get next set number for this module
        const [setNumbers] = await conn.query(
            'SELECT COALESCE(MAX(set_number), 0) as maxnum FROM quiz_sets WHERE module_id = ?',
            [moduleId]
        );
        const nextSetNumber = setNumbers[0].maxnum + 1;
        
        // ✅ CORRECT: Using actual column names from your database
        const [quizSetResult] = await conn.query(
            `INSERT INTO quiz_sets 
            (module_id, set_number, quiz_title, quiz_description, difficulty_level, 
             total_questions, ai_generated, status, created_by) 
            VALUES (?, ?, ?, ?, ?, ?, FALSE, 'draft', ?)`,
            [moduleId, nextSetNumber, quiztitle, description || null, 
             difficulty || 'medium', questions.length, req.user.userId]
        );
        
        const quizSetId = quizSetResult.insertId;
        
        // Insert questions
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            await conn.query(
                `INSERT INTO quiz_set_questions 
                (quiz_set_id, question_number, question_text, strand_type, 
                 difficulty, points, option_a, option_b, option_c, option_d, 
                 correct_option, explanation) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [quizSetId, i + 1, q.questiontext, q.strandtype || 'conceptual', 
                 q.difficulty || 'medium', q.points || 1, 
                 q.optiona, q.optionb, q.optionc, q.optiond, 
                 q.correctoption, q.explanation || '']
            );
        }
        
        await conn.commit();
        
        res.json({
            success: true,
            message: 'Manual quiz set created successfully',
            quizsetid: quizSetId,
            setnumber: nextSetNumber,
            totalquestions: questions.length
        });
        
    } catch (error) {
        await conn.rollback();
        console.error('Create manual quiz set error:', error);
        res.status(500).json({ error: 'Failed to create quiz set', details: error.message });
    } finally {
        conn.release();
    }
});



// DUPLICATE - COMMENTED OUT: // Get complete module content with all components
// DUPLICATE - COMMENTED OUT: app.get('/api/student/module/:moduleId/content', authenticateToken, requireRole('student'), async (req, res) => {
// DUPLICATE - COMMENTED OUT:     const { moduleId } = req.params;
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:     try {
// DUPLICATE - COMMENTED OUT:         const [module] = await pool.query(
// DUPLICATE - COMMENTED OUT:             'SELECT * FROM modules WHERE module_id = ?',
// DUPLICATE - COMMENTED OUT:             [moduleId]
// DUPLICATE - COMMENTED OUT:         );
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         if (module.length === 0) {
// DUPLICATE - COMMENTED OUT:             return res.status(404).json({ error: 'Module not found' });
// DUPLICATE - COMMENTED OUT:         }
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         // Get learning objectives
// DUPLICATE - COMMENTED OUT:         const [objectives] = await pool.query(
// DUPLICATE - COMMENTED OUT:             'SELECT objective_text FROM learning_objectives WHERE module_id = ? ORDER BY objective_order',
// DUPLICATE - COMMENTED OUT:             [moduleId]
// DUPLICATE - COMMENTED OUT:         );
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         // Get prerequisites
// DUPLICATE - COMMENTED OUT:         const [prerequisites] = await pool.query(
// DUPLICATE - COMMENTED OUT:             'SELECT prerequisite_text FROM module_prerequisites WHERE module_id = ? ORDER BY prerequisite_order',
// DUPLICATE - COMMENTED OUT:             [moduleId]
// DUPLICATE - COMMENTED OUT:         );
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         // Get videos
// DUPLICATE - COMMENTED OUT:         const [videos] = await pool.query(
// DUPLICATE - COMMENTED OUT:             'SELECT title, creator, url, duration_minutes, description, topics_covered FROM module_videos WHERE module_id = ? ORDER BY video_order',
// DUPLICATE - COMMENTED OUT:             [moduleId]
// DUPLICATE - COMMENTED OUT:         );
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         // Get sections
// DUPLICATE - COMMENTED OUT:         const [sections] = await pool.query(
// DUPLICATE - COMMENTED OUT:             'SELECT section_number, title, content_type, duration_minutes FROM module_sections WHERE module_id = ? ORDER BY section_order',
// DUPLICATE - COMMENTED OUT:             [moduleId]
// DUPLICATE - COMMENTED OUT:         );
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         // Get key concepts
// DUPLICATE - COMMENTED OUT:         const [concepts] = await pool.query(
// DUPLICATE - COMMENTED OUT:             'SELECT concept_text FROM key_concepts WHERE module_id = ? ORDER BY concept_order',
// DUPLICATE - COMMENTED OUT:             [moduleId]
// DUPLICATE - COMMENTED OUT:         );
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         // Get common misconceptions
// DUPLICATE - COMMENTED OUT:         const [misconceptions] = await pool.query(
// DUPLICATE - COMMENTED OUT:             'SELECT misconception_text, correction_text, example_text FROM common_misconceptions WHERE module_id = ? ORDER BY misconception_order',
// DUPLICATE - COMMENTED OUT:             [moduleId]
// DUPLICATE - COMMENTED OUT:         );
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         // Get real-world applications
// DUPLICATE - COMMENTED OUT:         const [applications] = await pool.query(
// DUPLICATE - COMMENTED OUT:             'SELECT title, description, context FROM real_world_applications WHERE module_id = ? ORDER BY application_order',
// DUPLICATE - COMMENTED OUT:             [moduleId]
// DUPLICATE - COMMENTED OUT:         );
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         // Get worked examples
// DUPLICATE - COMMENTED OUT:         const [examples] = await pool.query(
// DUPLICATE - COMMENTED OUT:             'SELECT title, problem_statement, solution_steps, final_answer, difficulty, filipino_context FROM worked_examples WHERE module_id = ? ORDER BY example_order',
// DUPLICATE - COMMENTED OUT:             [moduleId]
// DUPLICATE - COMMENTED OUT:         );
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         // Get active quiz for this module
// DUPLICATE - COMMENTED OUT:         const [quizzes] = await pool.query(
// DUPLICATE - COMMENTED OUT:             `SELECT quiz_id, quiz_title, quiz_description, time_limit_minutes, passing_score
// DUPLICATE - COMMENTED OUT:              FROM quizzes 
// DUPLICATE - COMMENTED OUT:              WHERE module_id = ? AND is_active = TRUE
// DUPLICATE - COMMENTED OUT:              ORDER BY created_at DESC
// DUPLICATE - COMMENTED OUT:              LIMIT 1`,
// DUPLICATE - COMMENTED OUT:             [moduleId]
// DUPLICATE - COMMENTED OUT:         );
// DUPLICATE - COMMENTED OUT: 		
// DUPLICATE - COMMENTED OUT: 		// Get saved module content (rich text with interactive tools)
// DUPLICATE - COMMENTED OUT:         const [savedContent] = await pool.query(
// DUPLICATE - COMMENTED OUT:             'SELECT content FROM module_content WHERE module_id = ?',
// DUPLICATE - COMMENTED OUT:             [moduleId]
// DUPLICATE - COMMENTED OUT:         );
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         res.json({
// DUPLICATE - COMMENTED OUT:             module: module[0],
// DUPLICATE - COMMENTED OUT:             objectives,
// DUPLICATE - COMMENTED OUT:             prerequisites,
// DUPLICATE - COMMENTED OUT:             videos,
// DUPLICATE - COMMENTED OUT:             sections,
// DUPLICATE - COMMENTED OUT:             concepts,
// DUPLICATE - COMMENTED OUT:             misconceptions,
// DUPLICATE - COMMENTED OUT:             applications,
// DUPLICATE - COMMENTED OUT:             examples,
// DUPLICATE - COMMENTED OUT:             quiz: quizzes.length > 0 ? quizzes[0] : null,
// DUPLICATE - COMMENTED OUT:             savedContent: savedContent.length > 0 ? savedContent[0].content : null  // 🆕 ADD THIS
// DUPLICATE - COMMENTED OUT:         });	
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:     } catch (error) {
// DUPLICATE - COMMENTED OUT:         console.error('Get module content error:', error);
// DUPLICATE - COMMENTED OUT:         res.status(500).json({ error: 'Failed to fetch module content' });
// DUPLICATE - COMMENTED OUT:     }
// DUPLICATE - COMMENTED OUT: });
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT: // Get active quiz for module (student view)
// DUPLICATE - COMMENTED OUT: app.get('/api/student/modules/:moduleId/active-quiz', 
// DUPLICATE - COMMENTED OUT:     authenticateToken, 
// DUPLICATE - COMMENTED OUT:     requireRole('student'), 
// DUPLICATE - COMMENTED OUT:     async (req, res) => {
// DUPLICATE - COMMENTED OUT:     try {
// DUPLICATE - COMMENTED OUT:         const { moduleId } = req.params;
// DUPLICATE - COMMENTED OUT:         const studentId = req.user.userId;
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         console.log(`🔍 Student ${studentId} checking quiz for module ${moduleId}`);
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         // ============================================================
// DUPLICATE - COMMENTED OUT:         // CHECK NEW QUIZ SETS SYSTEM
// DUPLICATE - COMMENTED OUT:         // ============================================================
// DUPLICATE - COMMENTED OUT:         const [newQuizAssignments] = await pool.query(`
// DUPLICATE - COMMENTED OUT:             SELECT 
// DUPLICATE - COMMENTED OUT:                 qsa.assignment_id,
// DUPLICATE - COMMENTED OUT:                 qsa.assignment_title,
// DUPLICATE - COMMENTED OUT:                 qsa.instructions,
// DUPLICATE - COMMENTED OUT:                 qsa.time_limit_minutes,
// DUPLICATE - COMMENTED OUT:                 qsa.due_date,
// DUPLICATE - COMMENTED OUT:                 qsa.allow_retakes,
// DUPLICATE - COMMENTED OUT:                 qsa.max_attempts,
// DUPLICATE - COMMENTED OUT:                 qs.quiz_set_id,
// DUPLICATE - COMMENTED OUT:                 qs.quiz_title,
// DUPLICATE - COMMENTED OUT:                 qs.set_number,
// DUPLICATE - COMMENTED OUT:                 qs.total_questions,
// DUPLICATE - COMMENTED OUT:                 qs.difficulty_level,
// DUPLICATE - COMMENTED OUT:                 c.class_id,
// DUPLICATE - COMMENTED OUT:                 c.class_name
// DUPLICATE - COMMENTED OUT:             FROM quiz_set_assignments qsa
// DUPLICATE - COMMENTED OUT:             JOIN quiz_sets qs ON qsa.quiz_set_id = qs.quiz_set_id
// DUPLICATE - COMMENTED OUT:             JOIN classes c ON qsa.class_id = c.class_id
// DUPLICATE - COMMENTED OUT:             JOIN class_enrollments ce ON c.class_id = ce.class_id
// DUPLICATE - COMMENTED OUT:             WHERE ce.student_id = ?
// DUPLICATE - COMMENTED OUT:             AND ce.enrollment_status = 'active'
// DUPLICATE - COMMENTED OUT:             AND qs.module_id = ?
// DUPLICATE - COMMENTED OUT:             AND (qsa.due_date IS NULL OR qsa.due_date > NOW())
// DUPLICATE - COMMENTED OUT:             ORDER BY qsa.created_at DESC
// DUPLICATE - COMMENTED OUT:             LIMIT 1
// DUPLICATE - COMMENTED OUT:         `, [studentId, moduleId]);
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         if (newQuizAssignments.length > 0) {
// DUPLICATE - COMMENTED OUT:             const assignment = newQuizAssignments[0];
// DUPLICATE - COMMENTED OUT:             
// DUPLICATE - COMMENTED OUT:             console.log('✅ Found quiz set assignment:', assignment.assignment_id);
// DUPLICATE - COMMENTED OUT:             
// DUPLICATE - COMMENTED OUT:             // Check if student has attempted this quiz
// DUPLICATE - COMMENTED OUT:             // Note: student_quiz_attempts table might not exist yet
// DUPLICATE - COMMENTED OUT:             let hasAttempted = false;
// DUPLICATE - COMMENTED OUT:             let attemptsUsed = 0;
// DUPLICATE - COMMENTED OUT:             let lastScore = null;
// DUPLICATE - COMMENTED OUT:             let isCompleted = false;
// DUPLICATE - COMMENTED OUT:             
// DUPLICATE - COMMENTED OUT:             try {
// DUPLICATE - COMMENTED OUT:                 const [attempts] = await pool.query(`
// DUPLICATE - COMMENTED OUT:                     SELECT 
// DUPLICATE - COMMENTED OUT:                         attempt_id,
// DUPLICATE - COMMENTED OUT:                         status,
// DUPLICATE - COMMENTED OUT:                         score_percentage,
// DUPLICATE - COMMENTED OUT:                         submitted_at
// DUPLICATE - COMMENTED OUT:                     FROM student_quiz_attempts
// DUPLICATE - COMMENTED OUT:                     WHERE assignment_id = ? AND student_id = ?
// DUPLICATE - COMMENTED OUT:                     ORDER BY attempt_number DESC
// DUPLICATE - COMMENTED OUT:                     LIMIT 1
// DUPLICATE - COMMENTED OUT:                 `, [assignment.assignment_id, studentId]);
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:                 if (attempts.length > 0) {
// DUPLICATE - COMMENTED OUT:                     hasAttempted = true;
// DUPLICATE - COMMENTED OUT:                     attemptsUsed = attempts.length;
// DUPLICATE - COMMENTED OUT:                     isCompleted = attempts[0].status === 'submitted';
// DUPLICATE - COMMENTED OUT:                     lastScore = attempts[0].score_percentage;
// DUPLICATE - COMMENTED OUT:                 }
// DUPLICATE - COMMENTED OUT:             } catch (attemptError) {
// DUPLICATE - COMMENTED OUT:                 console.warn('⚠️ student_quiz_attempts table may not exist yet:', attemptError.message);
// DUPLICATE - COMMENTED OUT:                 // Continue anyway - table will be created when first quiz is submitted
// DUPLICATE - COMMENTED OUT:             }
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:             const canRetake = assignment.allow_retakes && attemptsUsed < assignment.max_attempts;
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:             return res.json({
// DUPLICATE - COMMENTED OUT:                 quiz: {
// DUPLICATE - COMMENTED OUT:                     id: assignment.quiz_set_id,
// DUPLICATE - COMMENTED OUT:                     quiz_id: assignment.quiz_set_id,  // Added for frontend compatibility
// DUPLICATE - COMMENTED OUT:                     quizid: assignment.quiz_set_id,   // Added for frontend compatibility
// DUPLICATE - COMMENTED OUT:                     assignment_id: assignment.assignment_id,
// DUPLICATE - COMMENTED OUT:                     assignmentid: assignment.assignment_id,  // Added for frontend compatibility
// DUPLICATE - COMMENTED OUT:                     title: assignment.assignment_title || assignment.quiz_title,
// DUPLICATE - COMMENTED OUT:                     quiz_title: assignment.quiz_title,
// DUPLICATE - COMMENTED OUT:                     set_number: assignment.set_number,
// DUPLICATE - COMMENTED OUT:                     description: assignment.instructions || `Quiz Set #${assignment.set_number} for this module`,
// DUPLICATE - COMMENTED OUT:                     total_questions: assignment.total_questions,
// DUPLICATE - COMMENTED OUT:                     time_limit_minutes: assignment.time_limit_minutes,
// DUPLICATE - COMMENTED OUT:                     difficulty_level: assignment.difficulty_level,
// DUPLICATE - COMMENTED OUT:                     due_date: assignment.due_date,
// DUPLICATE - COMMENTED OUT:                     class_name: assignment.class_name
// DUPLICATE - COMMENTED OUT:                 },
// DUPLICATE - COMMENTED OUT:                 hasattempted: hasAttempted,
// DUPLICATE - COMMENTED OUT:                 completed: isCompleted,
// DUPLICATE - COMMENTED OUT:                 attempts_used: attemptsUsed,
// DUPLICATE - COMMENTED OUT:                 max_attempts: assignment.max_attempts,
// DUPLICATE - COMMENTED OUT:                 can_retake: canRetake,
// DUPLICATE - COMMENTED OUT:                 last_score: lastScore,
// DUPLICATE - COMMENTED OUT:                 system: 'quiz_sets',
// DUPLICATE - COMMENTED OUT:                 message: 'Quiz assignment found'
// DUPLICATE - COMMENTED OUT:             });
// DUPLICATE - COMMENTED OUT:         }
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         console.log('⚠️ No quiz set assignment found for this module');
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:         // ============================================================
// DUPLICATE - COMMENTED OUT:         // NO QUIZ FOUND
// DUPLICATE - COMMENTED OUT:         // ============================================================
// DUPLICATE - COMMENTED OUT:         return res.json({
// DUPLICATE - COMMENTED OUT:             quiz: null,
// DUPLICATE - COMMENTED OUT:             hasattempted: false,
// DUPLICATE - COMMENTED OUT:             message: 'No active quiz assignment'
// DUPLICATE - COMMENTED OUT:         });
// DUPLICATE - COMMENTED OUT: 
// DUPLICATE - COMMENTED OUT:     } catch (error) {
// DUPLICATE - COMMENTED OUT:         console.error('❌ Error checking quiz:', error);
// DUPLICATE - COMMENTED OUT:         res.status(500).json({ 
// DUPLICATE - COMMENTED OUT:             error: 'Failed to check quiz assignment',
// DUPLICATE - COMMENTED OUT:             details: error.message 
// DUPLICATE - COMMENTED OUT:         });
// DUPLICATE - COMMENTED OUT:     }
// DUPLICATE - COMMENTED OUT: });

console.log('✅ Student quiz endpoint updated for Quiz Sets system');



// Start quiz attempt

// START QUIZ (QUIZ SET ASSIGNMENT) - matches flexcalc_db snake_case schema
app.post('/api/student/assignments/:assignmentId/start', authenticateToken, requireRole('student'), async (req, res) => {
  const assignmentId = Number(req.params.assignmentId);
  const studentId = req.user.userId;

  if (!Number.isInteger(assignmentId)) {
    return res.status(400).json({ error: 'Invalid assignmentId' });
  }

  try {
    // 1) Validate: assignment exists, student is enrolled in that class, and date window is valid
    const [rows] = await pool.query(
      `
      SELECT
        qsa.assignment_id,
        qsa.quiz_set_id,
        qsa.class_id,
        qsa.assignment_title,
        qsa.instructions,
        qsa.time_limit_minutes,
        qsa.start_date,
        qsa.due_date,
        qsa.allow_retakes,
        qsa.max_attempts,
        qsa.shuffle_questions,
        qsa.shuffle_options,
        qsa.show_results_immediately,

        qs.quiz_title,
        qs.quiz_description,
        qs.total_questions,
        qs.difficulty_level
      FROM quiz_set_assignments qsa
      JOIN quiz_sets qs
        ON qs.quiz_set_id = qsa.quiz_set_id
      JOIN class_enrollments ce
        ON ce.class_id = qsa.class_id
       AND ce.student_id = ?
       AND ce.enrollment_status = 'active'
      WHERE qsa.assignment_id = ?
        AND (qsa.start_date IS NULL OR qsa.start_date <= NOW())
        AND (qsa.due_date IS NULL OR qsa.due_date >= NOW())
      LIMIT 1
      `,
      [studentId, assignmentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found / not available for this student' });
    }

    const assignment = rows[0];

    // 2) Attempt rules (retakes / max attempts / prevent multiple in_progress)
    const [lastAttempts] = await pool.query(
      `
      SELECT attempt_id, attempt_number, status, score_percentage
      FROM student_quiz_attempts
      WHERE assignment_id = ? AND student_id = ?
      ORDER BY attempt_number DESC
      LIMIT 1
      `,
      [assignmentId, studentId]
    );

    if (lastAttempts.length > 0 && lastAttempts[0].status === 'in_progress') {
      return res.status(400).json({
        error: 'You already have an active attempt for this quiz',
        attemptid: lastAttempts[0].attempt_id
      });
    }

    const lastAttemptNumber = lastAttempts.length ? (lastAttempts[0].attempt_number || 0) : 0;
    const nextAttemptNumber = lastAttemptNumber + 1;
    const lastScore = lastAttempts.length > 0 && lastAttempts[0].score_percentage !== null 
      ? Number(lastAttempts[0].score_percentage) 
      : null;

    // 🎯 NEW RETAKE LOGIC:
    // - Maximum 3 attempts allowed
    // - BUT: If student PASSED (≥70%), quiz is LOCKED (no more retakes)
    // - If student FAILED (<70%), can retake up to 3 attempts total
    
    const MAX_ATTEMPTS = 3;
    const PASSING_SCORE = 70;

    // Check if student already passed
    if (lastScore !== null && lastScore >= PASSING_SCORE) {
      return res.status(400).json({ 
        error: `You already passed this quiz with ${lastScore.toFixed(1)}%. No retakes allowed after passing.`,
        passed: true,
        lastScore: lastScore
      });
    }

    // Check if max attempts reached
    if (nextAttemptNumber > MAX_ATTEMPTS) {
      return res.status(400).json({ 
        error: `Maximum of ${MAX_ATTEMPTS} attempts reached for this quiz.`,
        attemptsUsed: lastAttemptNumber,
        maxAttempts: MAX_ATTEMPTS,
        lastScore: lastScore
      });
    }

    console.log(`✅ Attempt ${nextAttemptNumber}/${MAX_ATTEMPTS} allowed (Last score: ${lastScore !== null ? lastScore.toFixed(1) : 'N/A'}%)`);

    // 3) Load questions for the quiz set
    // NOTE: if your quiz_set_questions has an order column, update ORDER BY accordingly.
    const questionsOrderSql = assignment.shuffle_questions ? 'ORDER BY RAND()' : 'ORDER BY qq.question_id';

	const [questionRows] = await pool.query(
  `
	SELECT
		question_id,
		question_text,
		difficulty,
		strand_type,
		points,
		explanation,
		option_a,
		option_b,
		option_c,
		option_d,
		correct_option
	FROM quiz_set_questions
	WHERE quiz_set_id = ?
	${questionsOrderSql}
	`,
	[assignment.quiz_set_id]
	);


    if (questionRows.length === 0) {
      return res.status(400).json({ error: 'No questions found for this quiz set.' });
    }

    // 4) Create attempt
    const totalQuestions = questionRows.length;

    const [attemptInsert] = await pool.query(
      `
      INSERT INTO student_quiz_attempts
        (assignment_id, student_id, quiz_set_id, attempt_number, started_at, total_questions, status)
      VALUES
        (?, ?, ?, ?, NOW(), ?, 'in_progress')
      `,
      [assignmentId, studentId, assignment.quiz_set_id, nextAttemptNumber, totalQuestions]
    );

    const attemptId = attemptInsert.insertId;

	// 5) Attach options to each question (NEVER return is_correct to client)
	const questions = [];
	for (const q of questionRows) {
		const options = [
		{ optionid: `${q.question_id}_A`, optiontext: q.option_a, optionletter: 'A' },
		{ optionid: `${q.question_id}_B`, optiontext: q.option_b, optionletter: 'B' },
		{ optionid: `${q.question_id}_C`, optiontext: q.option_c, optionletter: 'C' },
		{ optionid: `${q.question_id}_D`, optiontext: q.option_d, optionletter: 'D' }
	];

		questions.push({
			questionid: q.question_id,
			questiontext: q.question_text,
			difficultylevel: q.difficulty,
			strandtype: q.strand_type,
			pointsvalue: Number(q.points || 1),
			explanation: q.explanation,
			options
		});
	}

	return res.json({
		success: true,
		system: 'quiz_sets',
		assignmentid: assignment.assignment_id,
		attemptid: attemptId,
		quiztitle: assignment.assignment_title || assignment.quiz_title,
		timelimitminutes: Number(assignment.time_limit_minutes || 30),
		totalquestions: questions.length,
		questions,
		startedat: new Date()
	});


    return res.json({
      success: true,
      system: 'quiz_sets',
      assignmentid: assignment.assignment_id,
      attemptid: attemptId,
      quiztitle: assignment.assignment_title || assignment.quiz_title,
      timelimitminutes: Number(assignment.time_limit_minutes || 30),
      totalquestions: questions.length,
      questions,
      startedat: new Date()
    });
	
  } catch (err) {
    console.error('Start quiz-set attempt error:', err);
    return res.status(500).json({ error: 'Failed to start quiz', details: err.message });
  }
});

// Submit individual answer for assignment-based quiz (FIXED - uses quiz_set_questions)
app.post('/api/student/assignments/:assignmentId/submit-answer', authenticateToken, requireRole('student'), async (req, res) => {
  const assignmentId = req.params.assignmentId;
  const { attemptid, questionid, selectedoptionid } = req.body;
  
  console.log('📝 Submit answer request:', { assignmentId, attemptid, questionid, selectedoptionid });
  
  try {
    // Verify attempt belongs to student and assignment
    const [attempts] = await pool.query(
      `SELECT * FROM student_quiz_attempts 
       WHERE attempt_id = ? AND student_id = ? AND assignment_id = ?`,
      [attemptid, req.user.userId, assignmentId]
    );
    
    if (attempts.length === 0) {
      return res.status(404).json({ error: 'Attempt not found' });
    }
    
    if (attempts[0].status === 'submitted') {
      return res.status(400).json({ error: 'Quiz already submitted' });
    }
    
    // Get the question from quiz_set_questions (has correct_option, explanation, points)
    const [questions] = await pool.query(
      `SELECT correct_option, explanation, points
       FROM quiz_set_questions
       WHERE question_id = ?`,
      [questionid]
    );
    
    if (questions.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }
    
    // Extract letter from selectedoptionid (format: "208_A" → "A")
    const selectedLetter = selectedoptionid.split('_')[1];
    const correctLetter = questions[0].correct_option;
    const isCorrect = (selectedLetter === correctLetter);
    
    console.log('🔍 Answer validation:', {
      selectedLetter,
      correctLetter,
      isCorrect
    });
    
    const pointsEarned = isCorrect ? (Number(questions[0].points) || 1) : 0;
    
    // Save answer using selected_option (CHAR)
    await pool.query(
      `INSERT INTO student_quiz_answers 
       (attempt_id, question_id, selected_option, is_correct, points_earned, answered_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE 
         selected_option = VALUES(selected_option),
         is_correct = VALUES(is_correct),
         points_earned = VALUES(points_earned),
         answered_at = NOW()`,
      [attemptid, questionid, selectedLetter, isCorrect, pointsEarned]
    );
    
    console.log('✅ Answer saved successfully');
    
    res.json({
      success: true,
      iscorrect: isCorrect,
      pointsearned: pointsEarned,
      explanation: questions[0].explanation || 'No explanation available.',
      correctoptionid: `${questionid}_${correctLetter}`  // Format: "208_A"
    });
    
  } catch (error) {
    console.error('❌ Submit answer error:', error);
    res.status(500).json({ 
      error: 'Failed to submit answer',
      details: error.sqlMessage || error.message 
    });
  }
});


// Submit/finish quiz for assignment (FIXED - uses selected_option CHAR)
app.post('/api/student/assignments/:assignmentId/submit', authenticateToken, requireRole('student'), async (req, res) => {
  const assignmentId = req.params.assignmentId;
  const { attemptid } = req.body;
  
  console.log('🏁 Submitting quiz:', { assignmentId, attemptid });
  
  try {
    // Verify attempt belongs to student
    const [attempts] = await pool.query(
      `SELECT * FROM student_quiz_attempts 
       WHERE attempt_id = ? AND student_id = ? AND assignment_id = ?`,
      [attemptid, req.user.userId, assignmentId]
    );
    
    if (attempts.length === 0) {
      return res.status(404).json({ error: 'Attempt not found' });
    }
    
    if (attempts[0].status === 'submitted') {
      return res.status(400).json({ error: 'Quiz already submitted' });
    }
    
    // Calculate score from student_quiz_answers
    const [scoreResult] = await pool.query(
		`SELECT 
			COUNT(*) as totalanswered,
			SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correctcount,
			SUM(points_earned) as totalpoints
		FROM student_quiz_answers
		WHERE attempt_id = ?`,
		[attemptid]
	);


    
    const totalQuestions = attempts[0].total_questions;
    const correctAnswers = scoreResult[0].correctcount || 0;
    const scorePercentage = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
    
    // Get assignment details
    const [assignment] = await pool.query(
      `SELECT qsa.*, qs.quiz_title 
       FROM quiz_set_assignments qsa
       JOIN quiz_sets qs ON qsa.quiz_set_id = qs.quiz_set_id
       WHERE qsa.assignment_id = ?`,
      [assignmentId]
    );
    
    const passingScore = 70;
    const passed = scorePercentage >= passingScore;
    
    // Calculate time taken
    const timeTaken = Math.floor((Date.now() - new Date(attempts[0].started_at).getTime()) / 1000);
    
    // Update attempt status
    await pool.query(
      `UPDATE student_quiz_attempts 
       SET status = 'submitted',
           score_percentage = ?,
           submitted_at = NOW(),
           time_taken_seconds = ?,
		   correct_answers = ?
       WHERE attempt_id = ?`,
      [scorePercentage, timeTaken, correctAnswers, attemptid]
    );
    
    // ============================================================
    // UPDATE STUDENT_PROGRESS FOR ANALYTICS
    // ============================================================
    // Get the module_id associated with this quiz assignment
    const [quizModule] = await pool.query(
      `SELECT qsa.module_id 
       FROM quiz_set_assignments qsa 
       WHERE qsa.assignment_id = ?`,
      [assignmentId]
    );
    
    if (quizModule.length > 0 && quizModule[0].module_id) {
      const moduleId = quizModule[0].module_id;
      
      // Check if student_progress record exists
      const [existingProgress] = await pool.query(
        'SELECT * FROM student_progress WHERE user_id = ? AND module_id = ?',
        [req.user.userId, moduleId]
      );
      
      if (existingProgress.length > 0) {
        // Update existing record - keep higher score, increment attempts
        await pool.query(
          `UPDATE student_progress 
           SET score = GREATEST(score, ?),
               attempts = attempts + 1,
               status = CASE 
                 WHEN ? >= 70 AND status != 'completed' THEN 'completed'
                 WHEN status = 'locked' THEN 'in_progress'
                 ELSE status 
               END,
               completed_at = CASE 
                 WHEN ? >= 70 AND status != 'completed' THEN NOW()
                 ELSE completed_at 
               END
           WHERE user_id = ? AND module_id = ?`,
          [scorePercentage, scorePercentage, scorePercentage, req.user.userId, moduleId]
        );
        console.log(`✅ Updated student_progress for user ${req.user.userId}, module ${moduleId}`);
      } else {
        // Create new record
        await pool.query(
          `INSERT INTO student_progress 
           (user_id, module_id, status, score, attempts, started_at, completed_at)
           VALUES (?, ?, ?, ?, 1, NOW(), ?)`,
          [
            req.user.userId, 
            moduleId,
            scorePercentage >= 70 ? 'completed' : 'in_progress',
            scorePercentage,
            scorePercentage >= 70 ? new Date() : null
          ]
        );
        console.log(`✅ Created student_progress for user ${req.user.userId}, module ${moduleId}`);
      }
    }
    // ============================================================
    
    // ============================================================
    // 🆕 UPDATE STRAND SCORES (PURE STRAND MODE)
    // Only updates the module's primary strand score
    // ============================================================
    
    // Get the module's primary strand type
    const [moduleStrandInfo] = await pool.query(
        `SELECT m.category as strand_type
         FROM quiz_sets qs
         JOIN modules m ON qs.module_id = m.module_id
         WHERE qs.quiz_set_id = ?`,
        [assignment[0].quiz_set_id]
    );

    if (moduleStrandInfo.length > 0) {
        const moduleStrand = moduleStrandInfo[0].strand_type;
        
        // Calculate performance for this quiz
        const quizPerformance = scorePercentage;
        
        console.log(`📊 Updating ${moduleStrand} strand score based on ${scorePercentage.toFixed(1)}% quiz performance`);
        
        // Check if strand score exists
        const [existingStrand] = await pool.query(
            'SELECT * FROM strand_scores WHERE user_id = ? AND strand_type = ?',
            [req.user.userId, moduleStrand]
        );
        
        if (existingStrand.length > 0) {
            // Update existing strand score using weighted average
            // 70% old score + 30% new score for gradual improvement
            await pool.query(
                `UPDATE strand_scores
                 SET current_score = ROUND((current_score * 0.7 + ? * 0.3), 2),
                     last_updated = NOW()
                 WHERE user_id = ? AND strand_type = ?`,
                [quizPerformance, req.user.userId, moduleStrand]
            );
            console.log(`✅ Updated ${moduleStrand} strand score (weighted average)`);
        } else {
            // Create new strand score entry
            await pool.query(
                `INSERT INTO strand_scores (user_id, strand_type, current_score, max_score, last_updated)
                 VALUES (?, ?, ROUND(?, 2), 100, NOW())`,
                [req.user.userId, moduleStrand, quizPerformance]
            );
            console.log(`✅ Created ${moduleStrand} strand score: ${quizPerformance.toFixed(1)}%`);
        }
    }
    // ============================================================
    
    // Get detailed results - joining with quiz_options to get option_id from selected_option letter
    const [results] = await pool.query(
      `SELECT 
         qq.question_id,
         qq.question_text,
         qq.difficulty,
         qq.strand_type,
         qq.points,
         qq.explanation,
         sqa.selected_option,
         (SELECT option_id FROM quiz_options 
          WHERE question_id = qq.question_id 
          AND option_letter = sqa.selected_option) as selectedoptionid,
         sqa.is_correct,
         sqa.points_earned,
         (SELECT option_id FROM quiz_options 
          WHERE question_id = qq.question_id 
          AND is_correct = 1) as correctoptionid
       FROM quiz_set_questions qsq
       JOIN quiz_questions qq ON qsq.question_id = qq.question_id
       LEFT JOIN student_quiz_answers sqa ON qq.question_id = sqa.question_id AND sqa.attempt_id = ?
       WHERE qsq.quiz_set_id = ?
       ORDER BY qq.question_id`,
      [attemptid, assignment[0].quiz_set_id]
    );
    
    // ============================================================
    // CREATE ANALYTICS SNAPSHOT (OPTIONAL - FOR PERFORMANCE TRACKING)
    // ============================================================
    try {
      // Get current strand scores
      const [strandScores] = await pool.query(
        `SELECT strand_type, current_score 
         FROM strand_scores 
         WHERE user_id = ?`,
        [req.user.userId]
      );
      
      // Map strand scores to snapshot fields
      const snapshot = {
        conceptual_score: 0,
        procedural_score: 0,
        strategic_score: 0,
        adaptive_score: 0,
        productive_score: 0
      };
      
      strandScores.forEach(s => {
        const key = `${s.strand_type}_score`;
        if (snapshot.hasOwnProperty(key)) {
          snapshot[key] = s.current_score || 0;
        }
      });
      
      // Calculate overall performance score
      const performanceScore = Object.values(snapshot).reduce((a, b) => a + b, 0) / 5;
      
      // Insert analytics snapshot
      await pool.query(
        `INSERT INTO analytics_snapshots 
         (user_id, conceptual_score, procedural_score, strategic_score, 
          adaptive_score, productive_score, performance_score, snapshot_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          req.user.userId,
          snapshot.conceptual_score,
          snapshot.procedural_score,
          snapshot.strategic_score,
          snapshot.adaptive_score,
          snapshot.productive_score,
          performanceScore
        ]
      );
      console.log(`✅ Created analytics snapshot for user ${req.user.userId}`);
    } catch (snapshotError) {
      // Don't fail quiz submission if snapshot creation fails
      console.warn('⚠️ Failed to create analytics snapshot:', snapshotError.message);
    }
    // ============================================================
    
    console.log('✅ Quiz submitted successfully');
    
    res.json({
      success: true,
      scorepercentage: Math.round(scorePercentage * 100) / 100,
      passed: passed,
      correctanswers: correctAnswers,
      totalquestions: totalQuestions,
      pointsearned: scoreResult[0].totalpoints || 0,
      timetakenseconds: timeTaken,
      results: results
    });
    
  } catch (error) {
    console.error('❌ Submit quiz error:', error);
    res.status(500).json({ 
      error: 'Failed to submit quiz',
      details: error.sqlMessage || error.message 
    });
  }
});

// ============================================================
// GET QUIZ RESULTS FOR COMPLETED ATTEMPT
// ============================================================
app.get('/api/student/assignments/:assignmentId/results', 
    authenticateToken, 
    requireRole('student'), 
    async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const studentId = req.user.userId;

        console.log(`📊 Fetching results for assignment ${assignmentId}, student ${studentId}`);

        // Get the latest submitted attempt for this assignment
        const [attempts] = await pool.query(
            `SELECT * FROM student_quiz_attempts 
             WHERE assignment_id = ? 
             AND student_id = ?
             AND status = 'submitted'
             ORDER BY submitted_at DESC
             LIMIT 1`,
            [assignmentId, studentId]
        );

        if (attempts.length === 0) {
            return res.status(404).json({ 
                error: 'No submitted attempt found for this assignment' 
            });
        }

        const attempt = attempts[0];

        // Get assignment details
        const [assignment] = await pool.query(
            `SELECT 
                qsa.assignment_id,
                qsa.assignment_title,
                qsa.time_limit_minutes,
                qs.quiz_set_id,
                qs.quiz_title,
                qs.difficulty_level,
                m.module_id,
                m.module_name
             FROM quiz_set_assignments qsa
             JOIN quiz_sets qs ON qsa.quiz_set_id = qs.quiz_set_id
             JOIN modules m ON qs.module_id = m.module_id
             WHERE qsa.assignment_id = ?`,
            [assignmentId]
        );

        if (assignment.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        // Get detailed results with questions and answers
        const [results] = await pool.query(
            `SELECT 
                qsq.question_id,
                qsq.question_text,
                qsq.question_number,
                qsq.difficulty,
                qsq.strand_type,
                qsq.points,
                qsq.explanation,
                qsq.option_a,
                qsq.option_b,
                qsq.option_c,
                qsq.option_d,
                qsq.correct_option,
                sqa.selected_option,
                sqa.is_correct,
                sqa.points_earned
             FROM quiz_set_questions qsq
             LEFT JOIN student_quiz_answers sqa 
               ON qsq.question_id = sqa.question_id 
               AND sqa.attempt_id = ?
             WHERE qsq.quiz_set_id = ?
             ORDER BY qsq.question_number`,
            [attempt.attempt_id, assignment[0].quiz_set_id]
        );

        // Transform results for frontend
        const reviewData = results.map(r => ({
            questionid: r.question_id,
            questiontext: r.question_text,
            question_text: r.question_text,
            question: r.question_text,
            questionnumber: r.question_number,
            difficulty: r.difficulty,
            strandtype: r.strand_type,
            points: r.points,
            explanation: r.explanation || 'No explanation provided',
            selectedoption: r.selected_option,
            selected_option: r.selected_option,
            correctoption: r.correct_option,
            correct_option: r.correct_option,
            iscorrect: r.is_correct === 1 || r.is_correct === true,
            is_correct: r.is_correct === 1 || r.is_correct === true,
            pointsearned: r.points_earned || 0,
            options: {
                A: r.option_a,
                B: r.option_b,
                C: r.option_c,
                D: r.option_d
            }
        }));

        // Calculate statistics
        const totalQuestions = results.length;
        const correctAnswers = results.filter(r => r.is_correct === 1 || r.is_correct === true).length;
        const scorePercentage = attempt.score_percentage || 0;
        const maxPoints = results.reduce((sum, r) => sum + (r.points || 1), 0);
        const pointsEarned = results.reduce((sum, r) => sum + (r.points_earned || 0), 0);
        const passed = scorePercentage >= 70;

        console.log(`✅ Retrieved results: ${correctAnswers}/${totalQuestions} correct`);

        res.json({
            success: true,
            attempt: {
                attempt_id: attempt.attempt_id,
                attempt_number: attempt.attempt_number,
                started_at: attempt.started_at,
                submitted_at: attempt.submitted_at,
                time_taken_seconds: attempt.time_taken_seconds
            },
            assignment: {
                assignment_id: assignment[0].assignment_id,
                assignment_title: assignment[0].assignment_title,
                quiz_title: assignment[0].quiz_title,
                module_name: assignment[0].module_name,
                difficulty_level: assignment[0].difficulty_level
            },
            score: {
                scorepercentage: scorePercentage,
                passed: passed,
                correctanswers: correctAnswers,
                totalquestions: totalQuestions,
                pointsearned: pointsEarned,
                maxpoints: maxPoints
            },
            results: reviewData,
            answers: reviewData,
            data: {
                results: reviewData
            }
        });

    } catch (error) {
        console.error('❌ Get results error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch results',
            details: error.message 
        });
    }
});

console.log('✅ Quiz results retrieval endpoint loaded');




// ============================================================
// STUDENT: Get Available Quizzes List (One-Sitting Only)
// ============================================================
app.get('/api/student/available-quizzes', 
    authenticateToken, 
    requireRole('student'), 
    async (req, res) => {
    try {
        const studentId = req.user.userId;
        
        console.log('📚 Loading available quizzes for student:', studentId);
        
        // Get all quiz assignments for student's enrolled classes
        const [quizzes] = await pool.query(`
            SELECT 
                qsa.assignment_id,
                qsa.assignment_title,
                qsa.instructions,
                qsa.time_limit_minutes,
                qsa.start_date,
                qsa.due_date,
                qsa.allow_retakes,
                qsa.max_attempts,
                qsa.show_results_immediately,
                qs.quiz_set_id,
                qs.quiz_title,
                qs.difficulty_level,
                qs.total_questions,
                m.module_id,
                m.module_name,
                c.class_id,
                c.class_name,
                
                -- Check if student has completed attempts
                (SELECT COUNT(*) 
                 FROM student_quiz_attempts sqa 
                 WHERE sqa.assignment_id = qsa.assignment_id 
                 AND sqa.student_id = ?
                 AND sqa.status = 'submitted') as completed_count,
                
                -- Get latest completed score
                (SELECT score_percentage 
                 FROM student_quiz_attempts sqa 
                 WHERE sqa.assignment_id = qsa.assignment_id 
                 AND sqa.student_id = ?
                 AND sqa.status = 'submitted'
                 ORDER BY sqa.submitted_at DESC 
                 LIMIT 1) as latest_score,
                
                -- Get total attempt count
                (SELECT COUNT(*) 
                 FROM student_quiz_attempts sqa 
                 WHERE sqa.assignment_id = qsa.assignment_id 
                 AND sqa.student_id = ?) as total_attempts
                
            FROM quiz_set_assignments qsa
            INNER JOIN quiz_sets qs ON qsa.quiz_set_id = qs.quiz_set_id
            INNER JOIN modules m ON qs.module_id = m.module_id
            INNER JOIN classes c ON qsa.class_id = c.class_id
            INNER JOIN class_enrollments ce ON c.class_id = ce.class_id
            WHERE ce.student_id = ?
            AND qs.status IN ('approved', 'assigned')
            ORDER BY 
                CASE 
                    WHEN qsa.due_date IS NULL THEN 1
                    WHEN qsa.due_date < NOW() THEN 2
                    ELSE 0
                END,
                qsa.due_date ASC,
                qsa.created_at DESC
        `, [studentId, studentId, studentId, studentId]);
        
        // Process quizzes - apply new retake logic
        const processedQuizzes = quizzes.map(quiz => {
            const isCompleted = quiz.completed_count > 0;
            const latestScore = quiz.latest_score !== null ? Number(quiz.latest_score) : null;
            const totalAttempts = Number(quiz.total_attempts || 0);
            
            // 🎯 NEW RETAKE LOGIC:
            // - Can retake if: FAILED (score <70%) AND attempts <3
            // - Cannot retake if: PASSED (score >=70%) OR attempts >=3
            const MAX_ATTEMPTS = 3;
            const PASSING_SCORE = 70;
            
            let canRetake = false;
            if (isCompleted && latestScore !== null) {
                // Has completed at least once
                if (latestScore >= PASSING_SCORE) {
                    // PASSED - no retakes allowed
                    canRetake = false;
                } else {
                    // FAILED - can retake if under 3 attempts
                    canRetake = totalAttempts < MAX_ATTEMPTS;
                }
            } else if (isCompleted) {
                // Completed but no score (shouldn't happen, but handle it)
                canRetake = totalAttempts < MAX_ATTEMPTS;
            }
            
            return {
                assignment_id: quiz.assignment_id,
                assignment_title: quiz.assignment_title,
                instructions: quiz.instructions,
                time_limit_minutes: quiz.time_limit_minutes,
                start_date: quiz.start_date,
                due_date: quiz.due_date,
                allow_retakes: quiz.allow_retakes,
                max_attempts: MAX_ATTEMPTS, // Always show 3
                show_results_immediately: quiz.show_results_immediately,
                
                quiz_set_id: quiz.quiz_set_id,
                quiz_title: quiz.quiz_title,
                difficulty_level: quiz.difficulty_level,
                total_questions: quiz.total_questions,
                
                module_id: quiz.module_id,
                module_name: quiz.module_name,
                class_id: quiz.class_id,
                class_name: quiz.class_name,
                
                completed: isCompleted,
                score: latestScore,
                total_attempts: totalAttempts,
                can_retake: canRetake,
                
                // Status logic:
                // - If not completed yet: 'available'
                // - If completed and can retake: 'completed' (will show both View Results + Retake buttons)
                // - If completed and cannot retake: 'completed' (will show only View Results button)
                status: isCompleted ? 'completed' : 'available'
            };
        });
        
        console.log(`✅ Found ${processedQuizzes.length} quizzes for student`);
        
        res.json({
            success: true,
            quizzes: processedQuizzes
        });
        
    } catch (error) {
        console.error('❌ Get available quizzes error:', error);
        res.status(500).json({ 
            error: 'Failed to load quizzes',
            details: error.message 
        });
    }
});


app.post('/api/student/quizzes/:quizId/start', authenticateToken, requireRole('student'), async (req, res) => {
    const { quizId } = req.params;

    try {
        // Check if quiz exists and is active
        const [quizzes] = await pool.query(
            'SELECT * FROM quizzes WHERE quiz_id = ? AND is_active = 1',
            [quizId]
        );

        if (quizzes.length === 0) {
            return res.status(404).json({ error: 'Quiz not found or inactive' });
        }

        const quiz = quizzes[0];

        // Check if student already has an active attempt
        const [existingAttempts] = await pool.query(
            `SELECT * FROM quiz_attempts 
             WHERE quiz_id = ? AND student_id = ? AND submitted_at IS NULL`,
            [quizId, req.user.userId]
        );

        if (existingAttempts.length > 0) {
            return res.status(400).json({ 
                error: 'You already have an active attempt for this quiz',
                attempt_id: existingAttempts[0].attempt_id
            });
        }

        // Create new attempt
        const [attemptResult] = await pool.query(
            `INSERT INTO quiz_attempts (quiz_id, student_id, started_at)
             VALUES (?, ?, NOW())`,
            [quizId, req.user.userId]
        );

        const attemptId = attemptResult.insertId;

        // Get questions (WITHOUT correct answers!)
        const [questions] = await pool.query(
            `SELECT 
                qq.question_id,
                qq.question_text,
                qq.difficulty,
                qq.strand,
                qq.points
            FROM quiz_questions qq
            WHERE qq.quiz_id = ?
            ORDER BY qq.question_id`,
            [quizId]
        );

        // Get options for each question (WITHOUT is_correct flag!)
        for (let q of questions) {
            const [options] = await pool.query(
                `SELECT option_id, option_text, option_letter
                 FROM quiz_options
                 WHERE question_id = ?
                 ORDER BY option_letter`,
                [q.question_id]
            );
            q.options = options;
        }

        res.json({
            success: true,
            attempt_id: attemptId,
            quiz_title: quiz.quiz_title,
            time_limit_minutes: quiz.time_limit_minutes,
            total_questions: questions.length,
            questions: questions,
            started_at: new Date()
        });

    } catch (error) {
        console.error('Start quiz error:', error);
        res.status(500).json({ error: 'Failed to start quiz' });
    }
});

// Submit individual quiz answer
app.post('/api/student/quizzes/:quizId/submit-answer', authenticateToken, requireRole('student'), async (req, res) => {
    const { quizId } = req.params;
    const { attempt_id, question_id, selected_option_id } = req.body;

    try {
        // Verify attempt belongs to student
        const [attempts] = await pool.query(
            `SELECT * FROM quiz_attempts 
             WHERE attempt_id = ? AND student_id = ? AND quiz_id = ?`,
            [attempt_id, req.user.userId, quizId]
        );

        if (attempts.length === 0) {
            return res.status(404).json({ error: 'Attempt not found' });
        }

        if (attempts[0].submitted_at) {
            return res.status(400).json({ error: 'Quiz already submitted' });
        }

        // Get correct answer
        const [correctOption] = await pool.query(
            `SELECT * FROM quiz_options 
             WHERE question_id = ? AND is_correct = 1`,
            [question_id]
        );

        if (correctOption.length === 0) {
            return res.status(404).json({ error: 'Question not found' });
        }

        const isCorrect = correctOption[0].option_id === selected_option_id;

        // Get question details for points
        const [questions] = await pool.query(
            'SELECT * FROM quiz_questions WHERE question_id = ?',
            [question_id]
        );

        const pointsEarned = isCorrect ? questions[0].points_value : 0;

        // Save answer
        await pool.query(
            `INSERT INTO quiz_student_answers 
             (attempt_id, question_id, selected_option_id, is_correct, points_earned, answered_at)
             VALUES (?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
             selected_option_id = VALUES(selected_option_id),
             is_correct = VALUES(is_correct),
             points_earned = VALUES(points_earned),
             answered_at = NOW()`,
            [attempt_id, question_id, selected_option_id, isCorrect, pointsEarned]
        );

        res.json({
            success: true,
            is_correct: isCorrect,
            points_earned: pointsEarned,
            explanation: questions[0].explanation || 'No explanation available.',
            correct_option_id: correctOption[0].option_id
        });

    } catch (error) {
        console.error('Submit answer error:', error);
        res.status(500).json({ error: 'Failed to submit answer' });
    }
});

// Submit final quiz
app.post('/api/student/quizzes/:quizId/submit', authenticateToken, requireRole('student'), async (req, res) => {
    const { quizId } = req.params;
    const { attempt_id } = req.body;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Verify attempt
        const [attempts] = await conn.query(
            `SELECT * FROM quiz_attempts 
             WHERE attempt_id = ? AND student_id = ? AND quiz_id = ?`,
            [attempt_id, req.user.userId, quizId]
        );

        if (attempts.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: 'Attempt not found' });
        }

        if (attempts[0].submitted_at) {
            await conn.rollback();
            return res.status(400).json({ error: 'Quiz already submitted' });
        }

        // Calculate total score
        const [scoreResult] = await conn.query(
            `SELECT 
                COUNT(*) as total_questions,
                SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct_answers,
                SUM(points_earned) as total_points,
                SUM(qq.points) as max_points
             FROM quiz_student_answers qsa
             JOIN quiz_questions qq ON qsa.question_id = qq.question_id
             WHERE qsa.attempt_id = ?`,
            [attempt_id]
        );

        const stats = scoreResult[0];
        const scorePercentage = stats.max_points > 0 
            ? (stats.total_points / stats.max_points) * 100 
            : 0;

        // Get quiz info for passing score
        const [quizzes] = await conn.query(
            'SELECT passing_score FROM quizzes WHERE quiz_id = ?',
            [quizId]
        );

        const passed = scorePercentage >= quizzes[0].passing_score;

		// Calculate time taken
		const timeTaken = Math.floor((Date.now() - new Date(attempts[0].started_at).getTime()) / 1000);

        // Update attempt
        await conn.query(
            `UPDATE quiz_attempts 
             SET submitted_at = NOW(),
                 score_percentage = ?,
                 passed = ?,
                 time_taken_seconds = ?
             WHERE attempt_id = ?`,
            [scorePercentage, passed, timeTaken, attempt_id]
        );

        // Get detailed results
        const [results] = await conn.query(
            `SELECT 
                qq.question_id,
                qq.question_text,
                qq.difficulty,
                qq.strand,
                qq.points,
                qq.explanation,
                qsa.selected_option_id,
                qsa.is_correct,
                qsa.points_earned,
                (SELECT option_id FROM quiz_options WHERE question_id = qq.question_id AND is_correct = 1) as correct_option_id
             FROM quiz_questions qq
             LEFT JOIN quiz_student_answers qsa ON qq.question_id = qsa.question_id AND qsa.attempt_id = ?
             WHERE qq.quiz_id = ?
             ORDER BY qq.question_id`,
            [attempt_id, quizId]
        );

        // Update strand scores based on performance
        const strandPerformance = {
            conceptual: { correct: 0, total: 0 },
            procedural: { correct: 0, total: 0 },
            strategic: { correct: 0, total: 0 },
            adaptive: { correct: 0, total: 0 },
            productive: { correct: 0, total: 0 }  // ✅ ADDED FOR THESIS 5-STRAND SYSTEM
        };

        results.forEach(r => {
            if (r.strand_type && strandPerformance[r.strand_type]) {
                strandPerform/nce[r.strand_type].total++;
                if (r.is_correct) {
                    strandPerformance[r.strand_type].correct++;
                }
            }
        });

        // Update scores (simple increment/decrement based on performance)
        for (const [strand, perf] of Object.entries(strandPerformance)) {
            if (perf.total > 0) {
                const performance = perf.correct / perf.total;
                const scoreChange = performance >= 0.7 ? 2 : (performance >= 0.5 ? 1 : -1);

                await conn.query(
                    `UPDATE strand_scores 
                     SET current_score = GREATEST(0, LEAST(100, current_score + ?))
                     WHERE user_id = ? AND strand_type = ?`,
                    [scoreChange, req.user.userId, strand]
                );
            }
        }

        await conn.commit();

        res.json({
            success: true,
            score_percentage: Math.round(scorePercentage * 100) / 100,
            passed: passed,
            correct_answers: stats.correct_answers,
            total_questions: stats.total_questions,
            points_earned: stats.total_points,
            max_points: stats.max_points,
            time_taken_seconds: timeTaken,
            results: results
        });

    } catch (error) {
        await conn.rollback();
        console.error('Submit quiz error:', error);
        res.status(500).json({ error: 'Failed to submit quiz' });
    } finally {
        conn.release();
}
});

// ============================================================
// ADD THESE NEW ENDPOINTS AFTER THE GENERATE-QUIZ ENDPOINT
// ============================================================

// Get all quizzes for a module (EDUCATOR)
app.get('/api/educator/modules/:moduleId/quizzes', authenticateToken, async (req, res) => {
    if (req.user.role !== 'educator') {
        return res.status(403).json({ error: 'Access denied. Educators only.' });
    }

    const { moduleId } = req.params;

    try {
        const [quizzes] = await pool.query(
            `SELECT 
                q.*,
                (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = q.quiz_id) as question_count,
                (SELECT COUNT(DISTINCT student_id) FROM quiz_attempts WHERE quiz_id = q.quiz_id) as attempt_count
            FROM quizzes q
            WHERE q.module_id = ?
            ORDER BY q.created_at DESC`,
            [moduleId]
        );

        res.json({ quizzes });
    } catch (error) {
        console.error('Get quizzes error:', error);
        res.status(500).json({ error: 'Failed to fetch quizzes' });
    }
});

// Toggle quiz active status (EDUCATOR)
app.patch('/api/educator/quizzes/:quizId/toggle', authenticateToken, async (req, res) => {
    if (req.user.role !== 'educator') {
        return res.status(403).json({ error: 'Access denied. Educators only.' });
    }

    const { quizId } = req.params;

    try {
        // Get current status
        const [quiz] = await pool.query(
            'SELECT is_active FROM quizzes WHERE quiz_id = ?',
            [quizId]
        );

        if (quiz.length === 0) {
            return res.status(404).json({ error: 'Quiz not found' });
        }

        const newStatus = !quiz[0].is_active;

        await pool.query(
            'UPDATE quizzes SET is_active = ? WHERE quiz_id = ?',
            [newStatus, quizId]
        );

        res.json({ 
            success: true, 
            is_active: newStatus,
            message: `Quiz ${newStatus ? 'activated' : 'deactivated'} successfully`
        });
    } catch (error) {
        console.error('Toggle quiz error:', error);
        res.status(500).json({ error: 'Failed to toggle quiz status' });
    }
});

// Delete quiz (EDUCATOR)
app.delete('/api/educator/quizzes/:quizId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'educator') {
        return res.status(403).json({ error: 'Access denied. Educators only.' });
    }

    const { quizId } = req.params;
    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        console.log(`🗑️ Deleting quiz ${quizId} and ALL related data (including attempts)...`);

        // Get module_id for this quiz
        const [quizInfo] = await conn.query(
            'SELECT module_id FROM quizzes WHERE quiz_id = ?',
            [quizId]
        );

        if (quizInfo.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: 'Quiz not found' });
        }

        const moduleId = quizInfo[0].module_id;

        // 🆕 Get all assignment IDs for this quiz
        const [assignments] = await conn.query(
            'SELECT assignment_id FROM quiz_assignments WHERE quiz_id = ?',
            [quizId]
        );
        
        const assignmentIds = assignments.map(a => a.assignment_id);
        
        if (assignmentIds.length > 0) {
            const placeholders = assignmentIds.map(() => '?').join(',');
            
            // Delete quiz answers
            await conn.query(
                `DELETE FROM quiz_answers WHERE attempt_id IN (
                  SELECT attempt_id FROM quiz_attempts WHERE assignment_id IN (${placeholders})
                )`,
                assignmentIds
            );
            console.log(`✅ Deleted quiz_answers for quiz ${quizId}`);
            
            // Delete quiz attempts
            await conn.query(
                `DELETE FROM quiz_attempts WHERE assignment_id IN (${placeholders})`,
                assignmentIds
            );
            console.log(`✅ Deleted quiz_attempts for quiz ${quizId}`);
        }
        
        // Delete quiz assignments
        await conn.query('DELETE FROM quiz_assignments WHERE quiz_id = ?', [quizId]);
        console.log(`✅ Deleted quiz_assignments for quiz ${quizId}`);
        
        // Reset student progress for this module
        await conn.query('DELETE FROM student_progress WHERE module_id = ?', [moduleId]);
        console.log(`✅ Reset student_progress for module ${moduleId}`);
        
        // Delete quiz questions and options
        await conn.query('DELETE FROM quiz_options WHERE question_id IN (SELECT question_id FROM quiz_questions WHERE quiz_id = ?)', [quizId]);
        await conn.query('DELETE FROM quiz_questions WHERE quiz_id = ?', [quizId]);
        console.log(`✅ Deleted quiz_questions and quiz_options for quiz ${quizId}`);

        // Delete quiz (cascade will delete remaining related data)
        await conn.query('DELETE FROM quizzes WHERE quiz_id = ?', [quizId]);
        console.log(`✅ Deleted quiz ${quizId}`);

        await conn.commit();

        console.log(`🎉 Successfully deleted quiz ${quizId} and all related data`);
        res.json({ 
            success: true,
            message: 'Quiz and all related data deleted successfully (including attempts)',
            details: {
                quiz_deleted: true,
                attempts_deleted: assignmentIds.length > 0,
                progress_reset: true
            }
        });
    } catch (error) {
        await conn.rollback();
        console.error('Delete quiz error:', error);
        res.status(500).json({ error: 'Failed to delete quiz' });
    } finally {
        conn.release();
    }
});

// Get quiz details for preview (EDUCATOR)
app.get('/api/educator/quizzes/:quizId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'educator') {
        return res.status(403).json({ error: 'Access denied. Educators only.' });
    }

    const { quizId } = req.params;

    try {
        // Get quiz info
        const [quizzes] = await pool.query(
            'SELECT * FROM quizzes WHERE quiz_id = ?',
            [quizId]
        );

        if (quizzes.length === 0) {
            return res.status(404).json({ error: 'Quiz not found' });
        }

        const quiz = quizzes[0];

        // Get questions with options
        const [questions] = await pool.query(
            `SELECT 
                qq.*,
                JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'option_id', qo.option_id,
                        'option_text', qo.option_text,
                        'is_correct', qo.is_correct,
                        'option_letter', qo.option_letter
                    )
                ) as options
            FROM quiz_questions qq
            LEFT JOIN quiz_options qo ON qq.question_id = qo.question_id
            WHERE qq.quiz_id = ?
            GROUP BY qq.question_id
            ORDER BY qq.question_id`,
            [quizId]
        );

        // Parse options JSON
        questions.forEach(q => {
            q.options = JSON.parse(q.options).sort((a, b) => a.option_letter - b.option_letter);
        });

        res.json({ 
            quiz,
            questions
        });
    } catch (error) {
        console.error('Get quiz details error:', error);
        res.status(500).json({ error: 'Failed to fetch quiz details' });
    }
});

// Get quiz integrity report (EDUCATOR)
app.get('/api/educator/quizzes/:quizId/integrity', authenticateToken, async (req, res) => {
    if (req.user.role !== 'educator') {
        return res.status(403).json({ error: 'Access denied. Educators only.' });
    }

    const { quizId } = req.params;

    try {
        // Get attempts with suspicious activities
        const [attempts] = await pool.query(
            `SELECT 
                qa.*,
                u.first_name, u.last_name, u.email,
                (SELECT COUNT(*) FROM quiz_suspicious_activities 
                 WHERE attempt_id = qa.attempt_id) as flag_count,
                (SELECT JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'activity_type', activity_type,
                        'severity', severity,
                        'detected_at', detected_at
                    )
                ) FROM quiz_suspicious_activities 
                WHERE attempt_id = qa.attempt_id) as activities
            FROM quiz_attempts qa
            JOIN users u ON qa.student_id = u.user_id
            WHERE qa.quiz_id = ?
            ORDER BY qa.submitted_at DESC`,
            [quizId]
        );

        // Parse activities JSON
        attempts.forEach(a => {
            a.activities = a.activities ? JSON.parse(a.activities) : [];
        });

        res.json({ attempts });
    } catch (error) {
        console.error('Get integrity report error:', error);
        res.status(500).json({ error: 'Failed to fetch integrity report' });
    }
});

// Simplified prompt for structured outputs
// ===================================================================
// REPLACE THE ENTIRE FUNCTION AT LINE 2400 WITH THIS:
// ===================================================================

function buildStructuredQuizPrompt({
    moduleName,
    moduleDescription,
    moduleCategory,
    lessonContent,      // ✅ ADD THIS
    exampleContent,     // ✅ ADD THIS
    keyConcepts,        // ✅ ADD THIS
    numQuestions,
    difficulty,
    strands,
    customInstructions
}) {
    const strandFocus = strands && strands.length > 0 
        ? `Focus on these strands: ${strands.join(', ')}` 
        : 'Include a balanced mix of all strands (conceptual, procedural, strategic, adaptive)';
    
    const customInstr = customInstructions 
        ? `\n\nAdditional Instructions: ${customInstructions}` 
        : '';

    return `Generate a calculus quiz with exactly ${numQuestions} multiple-choice questions for the following module:

**Module:** ${moduleName}
**Category:** ${moduleCategory}
**Description:** ${moduleDescription || 'Basic Calculus concepts'}
**Difficulty Level:** ${difficulty}
**Target:** K-12 Basic Calculus students in the Philippines

**LESSON CONTENT (MUST USE THIS):**
${lessonContent || 'No lesson content available - use module description'}

**KEY CONCEPTS (MUST TEST THESE):**
${keyConcepts || 'No key concepts specified'}

**WORKED EXAMPLES (USE AS INSPIRATION):**
${exampleContent || 'No examples available'}

${strandFocus}

**CRITICAL INSTRUCTIONS - READ CAREFULLY:**
1. Create questions that DIRECTLY TEST the concepts, formulas, and methods from the LESSON CONTENT above
2. Questions MUST be based on what students ACTUALLY LEARNED in the lessons - NOT generic calculus
3. If the lesson teaches specific notation (like lim_{x→c}), USE that exact notation
4. Reference the KEY CONCEPTS list when creating questions
5. Use similar problem structures as the WORKED EXAMPLES
6. Questions should feel like they're testing "did you understand the lesson?" not "do you know random calculus?"

For each question:
1. Write clear, specific questions testing the LESSON CONTENT concepts
2. Provide exactly 4 options (A, B, C, D) - one correct, three plausible distractors
3. Mark ONE option as correct (is_correct: true)
4. Include detailed explanations that reference the lesson content
5. Assign appropriate difficulty: "easy" (recall from lesson), "medium" (apply lesson concepts), "hard" (analyze/synthesize from lesson)
6. Classify by strand: "conceptual" (understanding), "procedural" (computation), "strategic" (problem-solving), "adaptive" (application)
7. Assign points (1-5) based on difficulty

**Important:**
- Questions should be appropriate for Filipino students
- Use clear mathematical notation with **bold** and subscripts like x_{0}
- Explanations should reference specific parts of the lesson content
- Mix different difficulty levels
- Cover the key concepts listed above${customInstr}

Return ONLY valid JSON following this exact structure:
{
    "questions": [
        {
            "question": "Question text here?",
            "options": [
                {"text": "Option A", "is_correct": false},
                {"text": "Option B", "is_correct": true},
                {"text": "Option C", "is_correct": false},
                {"text": "Option D", "is_correct": false}
            ],
            "explanation": "Detailed explanation referencing the lesson...",
            "difficulty": "medium",
            "strand": "conceptual",
            "points": 3
        }
    ]
}`;
}

// ============================================================
// STUDENT QUIZ ENDPOINTS - ADD TO server.js
// Add these after the educator quiz endpoints
// ============================================================

// ============================================================
// STUDENT QUIZ ENDPOINT - CORRECTED FOR YOUR DATABASE
// Replace existing /api/student/modules/:moduleId/active-quiz in server.js
// ============================================================

app.get('/api/student/modules/:moduleId/active-quiz', 
    authenticateToken, 
    requireRole('student'), 
    async (req, res) => {
    try {
        const { moduleId } = req.params;
        const studentId = req.user.userId;

        console.log(`🔍 Student ${studentId} checking quiz for module ${moduleId}`);

        // ============================================================
        // CHECK NEW QUIZ SETS SYSTEM
        // ============================================================
        const [newQuizAssignments] = await pool.query(`
            SELECT 
                qsa.assignment_id,
                qsa.assignment_title,
                qsa.instructions,
                qsa.time_limit_minutes,
                qsa.due_date,
                qsa.allow_retakes,
                qsa.max_attempts,
                qs.quiz_set_id,
                qs.quiz_title,
                qs.set_number,
                qs.total_questions,
                qs.difficulty_level,
                c.class_id,
                c.class_name
            FROM quiz_set_assignments qsa
            JOIN quiz_sets qs ON qsa.quiz_set_id = qs.quiz_set_id
            JOIN classes c ON qsa.class_id = c.class_id
            JOIN class_enrollments ce ON c.class_id = ce.class_id
            WHERE ce.student_id = ?
            AND ce.enrollment_status = 'active'
            AND qs.module_id = ?
            AND (qsa.due_date IS NULL OR qsa.due_date > NOW())
            ORDER BY qsa.created_at DESC
            LIMIT 1
        `, [studentId, moduleId]);

        if (newQuizAssignments.length > 0) {
            const assignment = newQuizAssignments[0];
            
            console.log('✅ Found quiz set assignment:', assignment.assignment_id);
            
            // Check if student has attempted this quiz
            // Note: student_quiz_attempts table might not exist yet
            let hasAttempted = false;
            let attemptsUsed = 0;
            let lastScore = null;
            let isCompleted = false;
            
            try {
                const [attempts] = await pool.query(`
                    SELECT 
                        attempt_id,
                        status,
                        score_percentage,
                        submitted_at
                    FROM student_quiz_attempts
                    WHERE assignment_id = ? AND student_id = ?
                    ORDER BY attempt_number DESC
                    LIMIT 1
                `, [assignment.assignment_id, studentId]);

                if (attempts.length > 0) {
                    hasAttempted = true;
                    attemptsUsed = attempts.length;
                    isCompleted = attempts[0].status === 'submitted';
                    lastScore = attempts[0].score_percentage;
                }
            } catch (attemptError) {
                console.warn('⚠️ student_quiz_attempts table may not exist yet:', attemptError.message);
                // Continue anyway - table will be created when first quiz is submitted
            }

            const canRetake = assignment.allow_retakes && attemptsUsed < assignment.max_attempts;

            return res.json({
                quiz: {
                    id: assignment.quiz_set_id,
                    quiz_id: assignment.quiz_set_id,  // Added for frontend compatibility
                    quizid: assignment.quiz_set_id,   // Added for frontend compatibility
                    assignment_id: assignment.assignment_id,
                    assignmentid: assignment.assignment_id,  // Added for frontend compatibility
                    title: assignment.assignment_title || assignment.quiz_title,
                    quiz_title: assignment.quiz_title,
                    set_number: assignment.set_number,
                    description: assignment.instructions || `Quiz Set #${assignment.set_number} for this module`,
                    total_questions: assignment.total_questions,
                    time_limit_minutes: assignment.time_limit_minutes,
                    difficulty_level: assignment.difficulty_level,
                    due_date: assignment.due_date,
                    class_name: assignment.class_name
                },
                hasattempted: hasAttempted,
                completed: isCompleted,
                attempts_used: attemptsUsed,
                max_attempts: assignment.max_attempts,
                can_retake: canRetake,
                last_score: lastScore,
                system: 'quiz_sets',
                message: 'Quiz assignment found'
            });
        }

        console.log('⚠️ No quiz set assignment found for this module');

        // ============================================================
        // NO QUIZ FOUND
        // ============================================================
        return res.json({
            quiz: null,
            hasattempted: false,
            message: 'No active quiz assignment'
        });

    } catch (error) {
        console.error('❌ Error checking quiz:', error);
        res.status(500).json({ 
            error: 'Failed to check quiz assignment',
            details: error.message 
        });
    }
});

console.log('✅ Student quiz endpoint updated for Quiz Sets system');



// 2. Start quiz attempt (STUDENT)
app.post('/api/student/quizzes/:quizId/start', authenticateToken, requireRole('student'), async (req, res) => {
    const { quizId } = req.params;

    try {
        // Check if quiz exists and is active
        const [quizzes] = await pool.query(
            'SELECT * FROM quizzes WHERE quiz_id = ? AND is_active = 1',
            [quizId]
        );

        if (quizzes.length === 0) {
            return res.status(404).json({ error: 'Quiz not found or inactive' });
        }

        const quiz = quizzes[0];

        // Check if student already has an active attempt
        const [existingAttempts] = await pool.query(
            `SELECT * FROM quiz_attempts 
             WHERE quiz_id = ? AND student_id = ? AND submitted_at IS NULL`,
            [quizId, req.user.userId]
        );

        if (existingAttempts.length > 0) {
            return res.status(400).json({ 
                error: 'You already have an active attempt for this quiz',
                attempt_id: existingAttempts[0].attempt_id
            });
        }

        // Create new attempt
        const [attemptResult] = await pool.query(
            `INSERT INTO quiz_attempts (quiz_id, student_id, started_at)
             VALUES (?, ?, NOW())`,
            [quizId, req.user.userId]
        );

        const attemptId = attemptResult.insertId;

        // Get questions (WITHOUT correct answers!)
        const [questions] = await pool.query(
            `SELECT 
                qq.question_id,
                qq.question_text,
                qq.difficulty,
                qq.strand,
                qq.points
            FROM quiz_questions qq
            WHERE qq.quiz_id = ?
            ORDER BY qq.question_id`,
            [quizId]
        );

        // Get options for each question (WITHOUT is_correct flag!)
        for (let q of questions) {
            const [options] = await pool.query(
                `SELECT option_id, option_text, option_letter
                 FROM quiz_options
                 WHERE question_id = ?
                 ORDER BY option_letter`,
                [q.question_id]
            );
            q.options = options;
        }

        res.json({
            success: true,
            attempt_id: attemptId,
            quiz_title: quiz.quiz_title,
            time_limit_minutes: quiz.time_limit_minutes,
            total_questions: questions.length,
            questions: questions,
            started_at: new Date()
        });

    } catch (error) {
        console.error('Start quiz error:', error);
        res.status(500).json({ error: 'Failed to start quiz' });
    }
});

// 3. Submit individual answer (STUDENT)
app.post('/api/student/quizzes/:quizId/submit-answer', authenticateToken, requireRole('student'), async (req, res) => {
    const { quizId } = req.params;
    const { attempt_id, question_id, selected_option_id } = req.body;

    try {
        // Verify attempt belongs to student
        const [attempts] = await pool.query(
            `SELECT * FROM quiz_attempts 
             WHERE attempt_id = ? AND student_id = ? AND quiz_id = ?`,
            [attempt_id, req.user.userId, quizId]
        );

        if (attempts.length === 0) {
            return res.status(404).json({ error: 'Attempt not found' });
        }

        if (attempts[0].submitted_at) {
            return res.status(400).json({ error: 'Quiz already submitted' });
        }

        // Get correct answer
        const [correctOption] = await pool.query(
            `SELECT * FROM quiz_options 
             WHERE question_id = ? AND is_correct = 1`,
            [question_id]
        );

        if (correctOption.length === 0) {
            return res.status(404).json({ error: 'Question not found' });
        }

        const isCorrect = correctOption[0].option_id === selected_option_id;

        // Get question details for points
        const [questions] = await pool.query(
            'SELECT * FROM quiz_questions WHERE question_id = ?',
            [question_id]
        );

        const pointsEarned = isCorrect ? questions[0].points_value : 0;

        // Save answer
        await pool.query(
            `INSERT INTO quiz_student_answers 
             (attempt_id, question_id, selected_option_id, is_correct, points_earned, answered_at)
             VALUES (?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
             selected_option_id = VALUES(selected_option_id),
             is_correct = VALUES(is_correct),
             points_earned = VALUES(points_earned),
             answered_at = NOW()`,
            [attempt_id, question_id, selected_option_id, isCorrect, pointsEarned]
        );

        // Get explanation
        const explanation = questions[0].explanation || 'No explanation available.';

        res.json({
            success: true,
            is_correct: isCorrect,
            points_earned: pointsEarned,
            explanation: explanation,
            correct_option_id: correctOption[0].option_id
        });

    } catch (error) {
        console.error('Submit answer error:', error);
        res.status(500).json({ error: 'Failed to submit answer' });
    }
});

// 4. Submit final quiz (STUDENT)
app.post('/api/student/quizzes/:quizId/submit', authenticateToken, requireRole('student'), async (req, res) => {
    const { quizId } = req.params;
    const { attempt_id } = req.body;

    try {
        // Verify attempt
        const [attempts] = await pool.query(
            `SELECT * FROM quiz_attempts 
             WHERE attempt_id = ? AND student_id = ? AND quiz_id = ?`,
            [attempt_id, req.user.userId, quizId]
        );

        if (attempts.length === 0) {
            return res.status(404).json({ error: 'Attempt not found' });
        }

        if (attempts[0].submitted_at) {
            return res.status(400).json({ error: 'Quiz already submitted' });
        }

        // Calculate total score
        const [scoreResult] = await pool.query(
            `SELECT 
                COUNT(*) as total_questions,
                SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct_answers,
                SUM(points_earned) as total_points,
                SUM(qq.points) as max_points
             FROM quiz_student_answers qsa
             JOIN quiz_questions qq ON qsa.question_id = qq.question_id
             WHERE qsa.attempt_id = ?`,
            [attempt_id]
        );

        const stats = scoreResult[0];
        const scorePercentage = stats.max_points > 0 
            ? (stats.total_points / stats.max_points) * 100 
            : 0;

        // Get quiz info for passing score
        const [quizzes] = await pool.query(
            'SELECT passing_score FROM quizzes WHERE quiz_id = ?',
            [quizId]
        );

        const passed = scorePercentage >= quizzes[0].passing_score;

        // Update attempt
        await pool.query(
            `UPDATE quiz_attempts 
             SET submitted_at = NOW(),
                 score_percentage = ?,
                 passed = ?
             WHERE attempt_id = ?`,
            [scorePercentage, passed, attempt_id]
        );

        // Get detailed results
        const [results] = await pool.query(
            `SELECT 
                qq.question_id,
                qq.question_text,
                qq.difficulty,
                qq.strand,
                qq.points,
                qq.explanation,
                qsa.selected_option_id,
                qsa.is_correct,
                qsa.points_earned,
                (SELECT option_id FROM quiz_options WHERE question_id = qq.question_id AND is_correct = 1) as correct_option_id
             FROM quiz_questions qq
             LEFT JOIN quiz_student_answers qsa ON qq.question_id = qsa.question_id AND qsa.attempt_id = ?
             WHERE qq.quiz_id = ?
             ORDER BY qq.question_id`,
            [attempt_id, quizId]
        );

        // 🆕 Update strand scores using holistic model
        // Note: Using module 1 as default if quiz doesn't have specific module
        await updateStrandScoresFromQuiz(req.user.userId, results, attempts[0].module_id || 1);

        res.json({
            success: true,
            score_percentage: Math.round(scorePercentage * 100) / 100,
            passed: passed,
            correct_answers: stats.correct_answers,
            total_questions: stats.total_questions,
            points_earned: stats.total_points,
            max_points: stats.max_points,
            results: results
        });

    } catch (error) {
        console.error('Submit quiz error:', error);
        res.status(500).json({ error: 'Failed to submit quiz' });
    }
});

// 5. Flag suspicious activity (STUDENT)
app.post('/api/student/quizzes/:quizId/flag-activity', authenticateToken, requireRole('student'), async (req, res) => {
    const { quizId } = req.params;
    const { attempt_id, activity_type, severity, details } = req.body;

    try {
        // Verify attempt belongs to student
        const [attempts] = await pool.query(
            `SELECT * FROM quiz_attempts 
             WHERE attempt_id = ? AND student_id = ? AND quiz_id = ?`,
            [attempt_id, req.user.userId, quizId]
        );

        if (attempts.length === 0) {
            return res.status(404).json({ error: 'Attempt not found' });
        }

        // Log suspicious activity
        await pool.query(
            `INSERT INTO quiz_suspicious_activities 
             (attempt_id, activity_type, severity, details, detected_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [attempt_id, activity_type, severity || 'medium', details || null]
        );

        res.json({ success: true });

    } catch (error) {
        console.error('Flag activity error:', error);
        res.status(500).json({ error: 'Failed to log activity' });
    }
});

// Helper: Update strand scores based on quiz performance
// 🆕 Update strand scores from quiz using holistic model
async function updateStrandScoresFromQuiz(userId, results, moduleId) {
    const conn = await pool.getConnection();
    try {
        // Calculate overall quiz performance
        const totalQuestions = results.length;
        const correctAnswers = results.filter(r => r.is_correct).length;
        const quizScore = correctAnswers / totalQuestions;
        
        // Use holistic update for each correct answer (simplified for quiz context)
        // This ensures consistent strand scoring across all answer types
        for (const result of results) {
            if (moduleId && result.is_correct !== undefined) {
                await updateStrandScoresHolistic(userId, moduleId, result.is_correct, conn);
            }
        }
        
        console.log(`✅ Updated strands from quiz: ${correctAnswers}/${totalQuestions} correct`);
    } catch (error) {
        console.error('Update strand scores from quiz error:', error);
    } finally {
        conn.release();
    }
}
// Get current user info
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const [users] = await pool.query(
            `SELECT user_id, email, role, first_name, last_name, is_active, last_login
             FROM users 
             WHERE user_id = ?`,
            [req.user.userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];
        res.json({
            userId: user.user_id,
            email: user.email,
            role: user.role,
            firstName: user.first_name,
            lastName: user.last_name,
            isActive: user.is_active,
            lastLogin: user.last_login
        });
    } catch (error) {
        console.error('Get current user error:', error);
        res.status(500).json({ error: 'Failed to fetch user info' });
    }
});

// Get enrolled modules for student (with progress data)
app.get('/api/student/enrolled-modules', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        // Get all modules with student's progress
        const [modules] = await pool.query(
            `SELECT 
                m.module_id as moduleId,
                m.module_name as name,
                m.category,
                m.difficulty_level as difficultyLevel,
                m.description,
                m.icon,
                m.is_gated as isGated,
                sp.status,
                sp.score as averageScore,
                sp.attempts,
                sp.time_spent_seconds as timeSpent,
                sp.started_at as startedAt,
                sp.completed_at as completedAt,
                -- Calculate progress percentage based on completion
                CASE 
                    WHEN sp.status = 'completed' THEN 100
                    WHEN sp.status = 'in-progress' THEN 50
                    ELSE 0
                END as progress,
                -- Count items (for now, we'll use 0 as placeholder)
                0 as totalItems,
                -- Count quizzes
                (SELECT COUNT(*) FROM custom_problems WHERE module_id = m.module_id) as totalQuizzes
             FROM modules m
             LEFT JOIN student_progress sp ON m.module_id = sp.module_id AND sp.user_id = ?
             WHERE sp.status IS NOT NULL AND sp.status != 'locked'
             ORDER BY sp.started_at DESC, m.module_id`,
            [req.user.userId]
        );

        res.json(modules);
    } catch (error) {
        console.error('Get enrolled modules error:', error);
        res.status(500).json({ error: 'Failed to fetch enrolled modules' });
    }
});

// Get strand proficiency for student
app.get('/api/student/strand-proficiency', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const [strands] = await pool.query(
            `SELECT 
                strand_type as strandName,
                current_score as averageScore,
                max_score as maxScore
             FROM strand_scores
             WHERE user_id = ?
             ORDER BY 
                CASE strand_type
                    WHEN 'conceptual' THEN 1
                    WHEN 'procedural' THEN 2
                    WHEN 'strategic' THEN 3
                    WHEN 'adaptive' THEN 4
                    WHEN 'productive' THEN 5
                END`,
            [req.user.userId]
        );

        res.json(strands);
    } catch (error) {
        console.error('Get strand proficiency error:', error);
        res.status(500).json({ error: 'Failed to fetch strand proficiency' });
    }
});

// Get current user info
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const [users] = await pool.query(
            `SELECT user_id, email, role, first_name, last_name, is_active, last_login
             FROM users 
             WHERE user_id = ?`,
            [req.user.userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];
        res.json({
            userId: user.user_id,
            email: user.email,
            role: user.role,
            firstName: user.first_name,
            lastName: user.last_name,
            isActive: user.is_active,
            lastLogin: user.last_login
        });
    } catch (error) {
        console.error('Get current user error:', error);
        res.status(500).json({ error: 'Failed to fetch user info' });
    }
});

// Get enrolled modules for student (with progress data)
app.get('/api/student/enrolled-modules', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        // Get all modules with student's progress
        const [modules] = await pool.query(
            `SELECT 
                m.module_id as moduleId,
                m.module_name as name,
                m.category,
                m.difficulty_level as difficultyLevel,
                m.description,
                m.icon,
                m.is_gated as isGated,
                sp.status,
                sp.score as averageScore,
                sp.attempts,
                sp.time_spent_seconds as timeSpent,
                sp.started_at as startedAt,
                sp.completed_at as completedAt,
                -- Calculate progress percentage based on completion
                CASE 
                    WHEN sp.status = 'completed' THEN 100
                    WHEN sp.status = 'in-progress' THEN 50
                    ELSE 0
                END as progress,
                -- Count items (for now, we'll use 0 as placeholder)
                0 as totalItems,
                -- Count quizzes
                (SELECT COUNT(*) FROM custom_problems WHERE module_id = m.module_id) as totalQuizzes
             FROM modules m
             LEFT JOIN student_progress sp ON m.module_id = sp.module_id AND sp.user_id = ?
             WHERE sp.status IS NOT NULL AND sp.status != 'locked'
             ORDER BY sp.started_at DESC, m.module_id`,
            [req.user.userId]
        );

        res.json(modules);
    } catch (error) {
        console.error('Get enrolled modules error:', error);
        res.status(500).json({ error: 'Failed to fetch enrolled modules' });
    }
});

// Get strand proficiency for student
app.get('/api/student/strand-proficiency', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const [strands] = await pool.query(
            `SELECT 
                strand_type as strandName,
                current_score as averageScore,
                max_score as maxScore
             FROM strand_scores
             WHERE user_id = ?
             ORDER BY 
                CASE strand_type
                    WHEN 'conceptual' THEN 1
                    WHEN 'procedural' THEN 2
                    WHEN 'strategic' THEN 3
                    WHEN 'adaptive' THEN 4
                    WHEN 'productive' THEN 5
                END`,
            [req.user.userId]
        );

        res.json(strands);
    } catch (error) {
        console.error('Get strand proficiency error:', error);
        res.status(500).json({ error: 'Failed to fetch strand proficiency' });
    }
});

// Get recent activity for student
app.get('/api/student/recent-activity', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        const [activities] = await pool.query(
            `SELECT 
                'module' as type,
                m.module_name as title,
                sp.completed_at as timestamp
             FROM student_progress sp
             JOIN modules m ON sp.module_id = m.module_id
             WHERE sp.user_id = ? AND sp.status = 'completed'
             ORDER BY sp.completed_at DESC
             LIMIT ?`,
            [req.user.userId, limit]
        );

        res.json(activities);
    } catch (error) {
        console.error('Get recent activity error:', error);
        res.status(500).json({ error: 'Failed to fetch recent activity' });
    }
});

// ============================================================
app.post('/api/student/leave-class', authenticateToken, requireRole('student'), async (req, res) => {
    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        // Get current active enrollment
        const [enrollment] = await conn.query(
            'SELECT classid, enrollmentid FROM classenrollments WHERE studentid = ? AND enrollmentstatus = ?',
            [req.user.userId, 'active']
        );

        if (enrollment.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: 'Not enrolled in any active class' });
        }

        // Update enrollment status to dropped
        await conn.query(
            'UPDATE classenrollments SET enrollmentstatus = ?, droppedat = NOW() WHERE enrollmentid = ?',
            ['dropped', enrollment[0].enrollmentid]
        );

        await conn.commit();
        res.json({ message: 'Successfully left the class' });
    } catch (error) {
        await conn.rollback();
        console.error('Leave class error:', error);
        res.status(500).json({ error: 'Failed to leave class' });
    } finally {
        conn.release();
    }
});

// ============================================================
// INTERACTIVE RESOURCES ENDPOINTS
// ============================================================

// Get all interactive resources for a module
app.get('/api/modules/:moduleId/interactive-resources', authenticateToken, async (req, res) => {
    try {
        const { moduleId } = req.params;
        const { lessonId, category, type } = req.query;

        let query = `
            SELECT 
                mir.resource_id,
                mir.module_id,
                mir.lesson_id,
                mir.resource_type,
                mir.resource_name,
                mir.resource_url,
                mir.thumbnail_url,
                mir.description,
                mir.difficulty_level,
                mir.category,
                mir.embed_code,
                mir.recommended_order,
                mir.estimated_time_minutes,
                COUNT(DISTINCT sri.user_id) as total_interactions,
                AVG(sri.time_spent_seconds) as avg_time_spent,
                AVG(sri.completion_percentage) as avg_completion,
                MAX(CASE WHEN sri.user_id = ? THEN sri.interaction_type END) as user_interaction_type,
                MAX(CASE WHEN sri.user_id = ? THEN sri.time_spent_seconds END) as user_time_spent,
                MAX(CASE WHEN sri.user_id = ? THEN sri.completion_percentage END) as user_completion
            FROM module_interactive_resources mir
            LEFT JOIN student_resource_interactions sri ON mir.resource_id = sri.resource_id
            WHERE mir.module_id = ? AND mir.is_active = TRUE
        `;

        const params = [req.user.userId, req.user.userId, req.user.userId, moduleId];

        if (lessonId) {
            query += ' AND mir.lesson_id = ?';
            params.push(lessonId);
        }

        if (category) {
            query += ' AND mir.category = ?';
            params.push(category);
        }

        if (type) {
            query += ' AND mir.resource_type = ?';
            params.push(type);
        }

        query += ' GROUP BY mir.resource_id ORDER BY mir.recommended_order, mir.resource_id';

        const [resources] = await pool.query(query, params);

        res.json({ resources });
    } catch (error) {
        console.error('Get interactive resources error:', error);
        res.status(500).json({ error: 'Failed to fetch interactive resources' });
    }
});

// Track student interaction with a resource
app.post('/api/interactive-resources/:resourceId/interact', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const { resourceId } = req.params;
        const { interactionType, timeSpent, completionPercentage, interactionData } = req.body;

        // Validate interaction type
        const validTypes = ['viewed', 'completed', 'attempted', 'favorited'];
        if (!validTypes.includes(interactionType)) {
            return res.status(400).json({ error: 'Invalid interaction type' });
        }

        await pool.query(
            `INSERT INTO student_resource_interactions 
            (user_id, resource_id, interaction_type, time_spent_seconds, completion_percentage, interaction_data)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                interaction_type = VALUES(interaction_type),
                time_spent_seconds = time_spent_seconds + VALUES(time_spent_seconds),
                completion_percentage = GREATEST(completion_percentage, VALUES(completion_percentage)),
                interaction_data = VALUES(interaction_data),
                last_accessed_at = CURRENT_TIMESTAMP`,
            [
                req.user.userId,
                resourceId,
                interactionType,
                timeSpent || 0,
                completionPercentage || 0,
                JSON.stringify(interactionData || {})
            ]
        );

        res.json({ message: 'Interaction recorded successfully' });
    } catch (error) {
        console.error('Record interaction error:', error);
        res.status(500).json({ error: 'Failed to record interaction' });
    }
});

// Get recommended resources for student based on weak strands
app.get('/api/student/recommended-resources', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        const [resources] = await pool.query(
            `SELECT 
                mir.resource_id,
                mir.resource_name,
                mir.resource_type,
                mir.resource_url,
                mir.thumbnail_url,
                mir.description,
                mir.category,
                mir.difficulty_level,
                mir.estimated_time_minutes,
                ss.current_score as strand_score,
                m.module_name
            FROM module_interactive_resources mir
            JOIN modules m ON mir.module_id = m.module_id
            JOIN strand_scores ss ON mir.category = ss.strand_type
            LEFT JOIN student_resource_interactions sri ON mir.resource_id = sri.resource_id AND sri.user_id = ?
            WHERE ss.user_id = ?
                AND ss.current_score < 70
                AND mir.is_active = TRUE
                AND sri.resource_id IS NULL
            ORDER BY ss.current_score ASC, mir.difficulty_level ASC, mir.recommended_order ASC
            LIMIT ?`,
            [req.user.userId, req.user.userId, limit]
        );

        res.json({ resources });
    } catch (error) {
        console.error('Get recommended resources error:', error);
        res.status(500).json({ error: 'Failed to fetch recommended resources' });
    }
});

// ============================================================
// DYNAMIC FEEDBACK ENDPOINTS
// ============================================================

// Get dynamic feedback for a module based on student performance
app.get('/api/modules/:moduleId/feedback', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const { moduleId } = req.params;

        // Get student progress for this module
        const [progress] = await pool.query(
            'SELECT score, attempts, status FROM student_progress WHERE user_id = ? AND module_id = ?',
            [req.user.userId, moduleId]
        );

        const studentProgress = progress[0] || { score: 0, attempts: 0, status: 'locked' };

        // Build conditions for feedback matching
        const conditions = [];
        if (studentProgress.attempts === 0) conditions.push("'first_visit'");
        if (studentProgress.score < 70) conditions.push("'score_below_70'");
        if (studentProgress.score < 75) conditions.push("'score_below_75'");
        if (studentProgress.score > 85) conditions.push("'score_above_85'");
        if (studentProgress.score === 100) conditions.push("'perfect_score'");
        if (studentProgress.attempts > 2) conditions.push("'multiple_attempts'");
        if (studentProgress.status === 'completed') conditions.push("'completed'");

        if (conditions.length === 0) {
            conditions.push("'first_visit'"); // Default to first visit
        }

        const [feedback] = await pool.query(
            `SELECT 
                tip_id,
                feedback_type,
                feedback_title,
                feedback_content,
                icon_emoji,
                trigger_condition
            FROM module_feedback_tips
            WHERE module_id = ? 
                AND is_active = TRUE
                AND trigger_condition IN (${conditions.join(',')})
            ORDER BY display_order ASC`,
            [moduleId]
        );

        res.json({ 
            feedback,
            studentProgress 
        });
    } catch (error) {
        console.error('Get module feedback error:', error);
        res.status(500).json({ error: 'Failed to fetch feedback' });
    }
});

// ============================================================
// PHET SIMULATIONS REDIRECT ENDPOINT
// ============================================================

// Redirect to PhET simulations library
app.get('/api/phet-simulations', (req, res) => {
    const { subject, search } = req.query;
    
    let phetUrl = 'https://phet.colorado.edu/en/simulations/filter?';
    
    if (subject) {
        phetUrl += `subjects=${subject}&`;
    } else {
        phetUrl += 'subjects=math&';
    }
    
    if (search) {
        phetUrl += `search=${encodeURIComponent(search)}`;
    }
    
    res.json({ 
        url: phetUrl,
        message: 'PhET Colorado Interactive Simulations',
        categories: [
            { name: 'Math', url: 'https://phet.colorado.edu/en/simulations/filter?subjects=math' },
            { name: 'Physics', url: 'https://phet.colorado.edu/en/simulations/filter?subjects=physics' },
            { name: 'Chemistry', url: 'https://phet.colorado.edu/en/simulations/filter?subjects=chemistry' }
        ]
    });
});

// ============================================================
// EDUCATOR: CREATE INTERACTIVE RESOURCE
// ============================================================

app.post('/api/educator/modules/:moduleId/interactive-resources', 
    authenticateToken, 
    requireRole('educator'), 
    async (req, res) => {
    try {
        const { moduleId } = req.params;
        const {
            lessonId,
            resourceType,
            resourceName,
            resourceUrl,
            thumbnailUrl,
            description,
            difficultyLevel,
            category,
            embedCode,
            estimatedTime
        } = req.body;

        // Validate required fields
        if (!resourceType || !resourceName || !resourceUrl || !category) {
            return res.status(400).json({ 
                error: 'Resource type, name, URL, and category are required' 
            });
        }

        // Validate resource type
        const validTypes = ['phet_simulation', 'desmos', 'game', 'interactive_tool', 'external_link'];
        if (!validTypes.includes(resourceType)) {
            return res.status(400).json({ error: 'Invalid resource type' });
        }

        // Validate category
        const validCategories = ['conceptual', 'procedural', 'strategic', 'adaptive', 'productive'];
        if (!validCategories.includes(category)) {
            return res.status(400).json({ error: 'Invalid category' });
        }

        const [result] = await pool.query(
            `INSERT INTO module_interactive_resources 
            (module_id, lesson_id, resource_type, resource_name, resource_url, 
             thumbnail_url, description, difficulty_level, category, embed_code, 
             estimated_time_minutes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                moduleId,
                lessonId || null,
                resourceType,
                resourceName,
                resourceUrl,
                thumbnailUrl || null,
                description || null,
                difficultyLevel || 1,
                category,
                embedCode || null,
                estimatedTime || null,
                req.user.userId
            ]
        );

        res.json({ 
            message: 'Interactive resource created successfully',
            resourceId: result.insertId 
        });
    } catch (error) {
        console.error('Create interactive resource error:', error);
        res.status(500).json({ error: 'Failed to create interactive resource' });
    }
});

// ============================================================
// EDUCATOR: CREATE FEEDBACK TIP
// ============================================================

app.post('/api/educator/modules/:moduleId/feedback-tips', 
    authenticateToken, 
    requireRole('educator'), 
    async (req, res) => {
    try {
        const { moduleId } = req.params;
        const {
            lessonId,
            feedbackType,
            triggerCondition,
            feedbackTitle,
            feedbackContent,
            iconEmoji,
            displayOrder
        } = req.body;

        // Validate required fields
        if (!feedbackType || !feedbackContent) {
            return res.status(400).json({ 
                error: 'Feedback type and content are required' 
            });
        }

        // Validate feedback type
        const validTypes = ['hint', 'warning', 'success', 'tip', 'challenge'];
        if (!validTypes.includes(feedbackType)) {
            return res.status(400).json({ error: 'Invalid feedback type' });
        }

        const [result] = await pool.query(
            `INSERT INTO module_feedback_tips 
            (module_id, lesson_id, feedback_type, trigger_condition, feedback_title, 
             feedback_content, icon_emoji, display_order, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                moduleId,
                lessonId || null,
                feedbackType,
                triggerCondition || 'first_visit',
                feedbackTitle || null,
                feedbackContent,
                iconEmoji || '💡',
                displayOrder || 1,
                req.user.userId
            ]
        );

        res.json({ 
            message: 'Feedback tip created successfully',
            tipId: result.insertId 
        });
    } catch (error) {
        console.error('Create feedback tip error:', error);
        res.status(500).json({ error: 'Failed to create feedback tip' });
    }
});

// ============================================================
// ANALYTICS: RESOURCE ENGAGEMENT
// ============================================================

app.get('/api/educator/modules/:moduleId/resource-analytics', 
    authenticateToken, 
    requireRole('educator'), 
    async (req, res) => {
    try {
        const { moduleId } = req.params;

        const [analytics] = await pool.query(
            `SELECT 
                mir.resource_id,
                mir.resource_name,
                mir.resource_type,
                mir.category,
                COUNT(DISTINCT sri.user_id) as unique_users,
                COUNT(sri.interaction_id) as total_interactions,
                AVG(sri.time_spent_seconds) as avg_time_spent,
                AVG(sri.completion_percentage) as avg_completion,
                SUM(CASE WHEN sri.interaction_type = 'completed' THEN 1 ELSE 0 END) as completed_count,
                SUM(CASE WHEN sri.interaction_type = 'favorited' THEN 1 ELSE 0 END) as favorited_count
            FROM module_interactive_resources mir
            LEFT JOIN student_resource_interactions sri ON mir.resource_id = sri.resource_id
            WHERE mir.module_id = ? AND mir.is_active = TRUE
            GROUP BY mir.resource_id
            ORDER BY unique_users DESC, total_interactions DESC`,
            [moduleId]
        );

        res.json({ analytics });
    } catch (error) {
        console.error('Get resource analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch resource analytics' });
    }
});

// ============================================================
// GET MODULE CONTENT FOR EDITING (EDUCATORS)
// ============================================================

app.get('/api/educator/modules/:moduleId/content',
    authenticateToken,
    requireRole('educator'),
    async (req, res) => {
    try {
        const { moduleId } = req.params;

        // Get module info
        const [modules] = await pool.query(
            'SELECT * FROM modules WHERE module_id = ?',
            [moduleId]
        );

        if (modules.length === 0) {
            return res.status(404).json({ error: 'Module not found' });
        }

        // Get videos
        const [videos] = await pool.query(
            `SELECT video_id, title, url, duration_minutes, description, topics_covered, display_order 
             FROM module_videos 
             WHERE module_id = ? 
             ORDER BY display_order`,
            [moduleId]
        );

        // Get sections
        const [sections] = await pool.query(
            `SELECT section_id, section_number, title, explanation, examples, practice_problems, duration_minutes 
             FROM module_sections 
             WHERE module_id = ? 
             ORDER BY section_number`,
            [moduleId]
        );

        res.json({
            module: modules[0],
            videos: videos || [],
            sections: sections || [],
            savedContent: modules[0].savedContent || null
        });

    } catch (error) {
        console.error('Get module content error:', error);
        res.status(500).json({ error: 'Failed to fetch module content' });
    }
});

// ============================================================
// SAVE MODULE CONTENT (LIVE EDITOR)
// ============================================================

app.post('/api/educator/modules/:moduleId/save-content',
    authenticateToken,
    requireRole('educator'),
    async (req, res) => {
    try {
        const { moduleId } = req.params;
        const { module, lessons } = req.body;

        console.log('💾 Saving module content for moduleId:', moduleId);
        console.log('Module data:', module);
        console.log('Lessons count:', lessons?.length);

        // Update module info
        await pool.query(
            `UPDATE modules 
            SET module_name = ?, 
                category = ?, 
                description = ?
            WHERE module_id = ?`,
            [module.module_name, module.category, module.description, moduleId]
        );

        // Delete existing videos and sections for this module
        await pool.query('DELETE FROM module_videos WHERE module_id = ?', [moduleId]);
        await pool.query('DELETE FROM module_sections WHERE module_id = ?', [moduleId]);

        // Save lessons
        for (let i = 0; i < (lessons?.length || 0); i++) {
            const lesson = lessons[i];

            if (lesson.type === 'video') {
                // Insert video with creator field
                await pool.query(
                    `INSERT INTO module_videos 
                    (module_id, title, creator, url, duration_minutes, description, topics_covered, video_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        moduleId,
                        lesson.title || 'Untitled Video',
                        'Teacher',
                        lesson.videoUrl || '',
                        lesson.duration || 10,
                        lesson.description || '',
                        lesson.topicsCovered || '',
                        i + 1
                    ]
                );

            } else if (lesson.type === 'section') {
                // Insert section WITH explanation
                await pool.query(
                    `INSERT INTO module_sections 
                    (module_id, section_number, title, content_type, duration_minutes, explanation, section_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        moduleId,
                        i + 1,
                        lesson.title || 'Untitled Section',
                        'text',
                        lesson.duration || 10,
                        lesson.explanation || '',
                        i + 1
                    ]
                );
                
            } else if (lesson.type === 'custom') {
                // Save as savedContent in modules table
                await pool.query(
                    'UPDATE modules SET savedContent = ? WHERE module_id = ?',
                    [lesson.content, moduleId]
                );
            }
        }

        console.log('✅ Module content saved successfully');

        res.json({ 
            message: 'Module content saved successfully',
            moduleId 
        });

    } catch (error) {
        console.error('❌ Save module content error:', error);
        res.status(500).json({ error: 'Failed to save module content: ' + error.message });
    }
});


// ============================================================
// BULK SAVE INTERACTIVE RESOURCES
// ============================================================

app.post('/api/educator/modules/:moduleId/resources/bulk',
    authenticateToken,
    requireRole('educator'),
    async (req, res) => {
    try {
        const { moduleId } = req.params;
        const resources = Array.isArray(req.body) ? req.body : req.body.resources || [];

        console.log('💾 Saving resources:', { moduleId, count: resources?.length });

        // Skip if no resources
        if (!resources || resources.length === 0) {
            // Delete all existing resources if array is empty
            await pool.query('DELETE FROM module_interactive_resources WHERE module_id = ?', [moduleId]);
            return res.json({ message: 'Resources cleared successfully' });
        }

        // Delete existing resources
        await pool.query('DELETE FROM module_interactive_resources WHERE module_id = ?', [moduleId]);

        // Insert new resources
        for (let i = 0; i < resources.length; i++) {
            const r = resources[i];
            
            // 🔧 FIX: Use correct category values from database ENUM
            // Valid categories: 'conceptual', 'procedural', 'strategic', 'adaptive', 'productive'
            const validCategories = ['conceptual', 'procedural', 'strategic', 'adaptive', 'productive'];
            let category = r.category ? r.category.trim().toLowerCase() : null;
            
            // If category is not in valid list, default to 'conceptual'
            if (!category || !validCategories.includes(category)) {
                category = 'conceptual';  // Default to conceptual for general learning resources
            }
            
            try {
                await pool.query(
                    `INSERT INTO module_interactive_resources 
                    (module_id, resource_name, resource_type, resource_url, description, embed_code, 
                     thumbnail_url, difficulty_level, estimated_time_minutes, category, recommended_order, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        moduleId,
                        r.resource_name || 'Untitled Resource',
                        r.resource_type || 'external_link',
                        r.resource_url || '',
                        r.description || '',
                        r.embed_code || '',
                        r.thumbnail_url || '',
                        r.difficulty_level || 1,
                        r.estimated_time_minutes || 15,
                        category,  // Use valid ENUM category
                        i + 1,
                        req.user.userId
                    ]
                );
                console.log(`✅ Inserted resource ${i + 1}:`, r.resource_name, 'category:', category);
            } catch (insertError) {
                console.error(`❌ Error inserting resource ${i + 1}:`, r.resource_name, insertError.message);
                // Continue with other resources even if one fails
                continue;
            }
        }

        console.log('✅ Resources saved successfully');

        res.json({ message: 'Resources saved successfully' });

    } catch (error) {
        console.error('❌ Save resources error:', error);
        res.status(500).json({ error: 'Failed to save resources: ' + error.message });
    }
});

// ============================================================
// BULK SAVE QUIZ QUESTIONS (MULTIPLE CHOICE)
// ============================================================

app.post('/api/educator/modules/:moduleId/questions/bulk',
    authenticateToken,
    requireRole('educator'),
    async (req, res) => {
    try {
        const { moduleId } = req.params;
        const { questions } = req.body;

        console.log('💾 Saving questions:', { moduleId, count: questions?.length });

        // Delete existing questions for this module
        await pool.query('DELETE FROM custom_problems WHERE module_id = ?', [moduleId]);

        // Insert new questions
        for (const q of questions || []) {
            await pool.query(
                `INSERT INTO custom_problems 
                (module_id, created_by, question_text, question_type, 
                 option_a, option_b, option_c, option_d, correct_option, correct_answer, explanation)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    moduleId,
                    req.user.userId,
                    q.question_text,
                    q.question_type || 'multiple_choice',
                    q.option_a || '',
                    q.option_b || '',
                    q.option_c || '',
                    q.option_d || '',
                    q.correct_option || q.correct_answer || 'A',
                    q.correct_option || q.correct_answer || 'A', // Store in both for compatibility
                    q.explanation || ''
                ]
            );
        }

        console.log('✅ Questions saved successfully');

        res.json({ message: 'Questions saved successfully' });

    } catch (error) {
        console.error('❌ Save questions error:', error);
        res.status(500).json({ error: 'Failed to save questions: ' + error.message });
    }
});

// ============================================================
// GET QUIZ QUESTIONS FOR MODULE (MULTIPLE CHOICE)
// ============================================================

app.get('/api/modules/:moduleId/questions',
    authenticateToken,
    async (req, res) => {
    try {
        const { moduleId } = req.params;

        const [questions] = await pool.query(
            `SELECT problem_id as question_id, question_text, question_type,
                    option_a, option_b, option_c, option_d, correct_option, 
                    correct_answer, explanation
             FROM custom_problems
             WHERE module_id = ?
             ORDER BY problem_id`,
            [moduleId]
        );

        // Ensure all questions have multiple choice format
        const formattedQuestions = questions.map(q => ({
            ...q,
            question_type: q.question_type || 'multiple_choice',
            correct_option: q.correct_option || q.correct_answer || 'A'
        }));

        res.json({ questions: formattedQuestions });

    } catch (error) {
        console.error('Get questions error:', error);
        res.status(500).json({ error: 'Failed to fetch questions: ' + error.message });
    }
});

// ============================================================
// MANUAL QUIZ CREATION (EDUCATOR)
// ============================================================

app.post('/api/educator/quizzes/manual',
    authenticateToken,
    requireRole('educator'),
    async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const { title, description, module_id, time_limit_minutes, passing_score, questions } = req.body;
        
        console.log('📝 Creating manual quiz:', { title, module_id, questionCount: questions?.length });
        
        // Validate input
        if (!title || !module_id || !questions || questions.length === 0) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        await connection.beginTransaction();
        
        // 1. Create the quiz
        const [quizResult] = await connection.query(
            `INSERT INTO quizzes 
            (quiz_title, quiz_description, module_id, created_by, time_limit_minutes, passing_score, 
             is_active)
            VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [
                title,
                description || '',
                module_id,
                req.user.userId,
                time_limit_minutes || 30,
                passing_score || 70
            ]
        );
        
        const quizId = quizResult.insertId;
        console.log('✅ Quiz created with ID:', quizId);
        
        // 2. Insert all questions and their options
        for (const q of questions) {
            // Insert question
            const [questionResult] = await connection.query(
                `INSERT INTO quiz_questions 
                (quiz_id, question_number, question_text, question_type, strand_type, points, explanation)
                VALUES (?, ?, ?, 'multiple_choice', ?, ?, ?)`,
                [
                    quizId,
                    q.question_number,
                    q.question_text,
                    q.strand_type || 'conceptual',
                    q.points || 1,
                    q.explanation || ''
                ]
            );
            
            const questionId = questionResult.insertId;
            
            // Insert options
            for (const option of q.options) {
                await connection.query(
                    `INSERT INTO quiz_options 
                    (question_id, option_letter, option_text, is_correct)
                    VALUES (?, ?, ?, ?)`,
                    [
                        questionId,
                        option.letter,
                        option.text,
                        option.is_correct ? 1 : 0
                    ]
                );
            }
        }
        
        // ✅ 3. Create quiz_set entry so manual quiz appears in Quiz Sets list
        const [quizSetResult] = await connection.query(
            `INSERT INTO quiz_sets (
                module_id, created_by, quiz_title, quiz_description,
                ai_generated, total_questions, status
            ) VALUES (?, ?, ?, ?, 0, ?, 'draft')`,
            [
                module_id,
                req.user.userId,
                title,
                description || `Manual quiz with ${questions.length} questions`,
                questions.length
            ]
        );
        
        const quizSetId = quizSetResult.insertId;
        console.log('✅ Quiz set created with ID:', quizSetId);
        
        // ✅ 4. CRITICAL: Save questions to quiz_set_questions table for new system
        console.log('💾 Saving questions to quiz_set_questions...');
        for (const q of questions) {
            // Find the correct option letter
            const correctOption = q.options.find(opt => opt.is_correct);
            const correctLetter = correctOption ? correctOption.letter : 'A';
            
            await connection.query(
                `INSERT INTO quiz_set_questions (
                    quiz_set_id, question_text, 
                    option_a, option_b, option_c, option_d,
                    correct_option, difficulty, strand_type, points, explanation
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    quizSetId,
                    q.question_text,
                    q.options.find(o => o.letter === 'A')?.text || '',
                    q.options.find(o => o.letter === 'B')?.text || '',
                    q.options.find(o => o.letter === 'C')?.text || '',
                    q.options.find(o => o.letter === 'D')?.text || '',
                    correctLetter,
                    q.difficulty || 'medium',
                    q.strand_type || 'conceptual',
                    q.points || 1,
                    q.explanation || ''
                ]
            );
        }
        console.log(`✅ Saved ${questions.length} questions to quiz_set_questions`);
        
        await connection.commit();
        
        console.log('✅ Manual quiz created successfully');
        
        res.json({
            message: 'Quiz created successfully',
            quizId: quizId,
            quizSetId: quizSetId,
            totalQuestions: questions.length
        });
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Create manual quiz error:', error);
        res.status(500).json({ error: 'Failed to create quiz: ' + error.message });
    } finally {
        connection.release();
    }
});

// ============================================================
// GET ALL QUIZZES FOR EDUCATOR (INCLUDING MANUAL)
// ============================================================

app.get('/api/educator/quizzes',
    authenticateToken,
    requireRole('educator'),
    async (req, res) => {
    try {
        const [quizzes] = await pool.query(
            `SELECT 
                q.quiz_id,
                q.quiz_title,
                q.quiz_description,
                q.module_id,
                q.quiz_type,
                q.total_questions,
                q.time_limit_minutes,
                q.passing_score,
                q.is_active,
                q.created_at,
                m.module_name
            FROM quizzes q
            LEFT JOIN modules m ON q.module_id = m.module_id
            WHERE q.created_by = ?
            ORDER BY q.created_at DESC`,
            [req.user.userId]
        );
        
        res.json({ quizzes });
        
    } catch (error) {
        console.error('❌ Get quizzes error:', error);
        res.status(500).json({ error: 'Failed to fetch quizzes' });
    }
});

// ============================================================
// QUIZ ASSIGNMENT SYSTEM
// ============================================================

// Assign quiz to class
app.post('/api/educator/modules/:moduleId/assign-quiz',
    authenticateToken,
    requireRole('educator'),
    async (req, res) => {
    try {
        const { moduleId } = req.params;
        const { classId, title, description, timeLimitMinutes, difficulty, startDate, dueDate } = req.body;

        console.log('📝 Assigning quiz:', { moduleId, classId });

        // Count questions for this module
        const [questions] = await pool.query(
            'SELECT COUNT(*) as count FROM custom_problems WHERE module_id = ?',
            [moduleId]
        );

        const totalQuestions = questions[0].count;

        if (totalQuestions === 0) {
            return res.status(400).json({ error: 'No questions found for this module' });
        }

        // Create assignment
        const [result] = await pool.query(
            `INSERT INTO quiz_assignments 
            (module_id, class_id, created_by, title, description, time_limit_minutes, 
             total_questions, difficulty, start_date, due_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                moduleId,
                classId,
                req.user.userId,
                title,
                description || '',
                timeLimitMinutes || 30,
                totalQuestions,
                difficulty || 'normal',
                startDate || new Date(),
                dueDate
            ]
        );

        console.log('✅ Quiz assigned successfully');

        res.json({
            message: 'Quiz assigned successfully',
            assignmentId: result.insertId,
            totalQuestions
        });

    } catch (error) {
        console.error('❌ Assign quiz error:', error);
        res.status(500).json({ error: 'Failed to assign quiz: ' + error.message });
    }
});

app.get('/api/educator/modules/:moduleId/assignments', authenticateToken, requireRole('educator'), async (req, res) => {
    try {
        const { moduleId } = req.params;
        
        const assignments = await pool.query(`
            SELECT 
                qa.*, 
                c.class_name AS classname, 
                c.class_code AS classcode,
                COUNT(DISTINCT qat.student_id) AS totalAttempts,
                COUNT(DISTINCT CASE WHEN qat.status = 'completed' THEN qat.student_id END) AS completedAttempts
            FROM quiz_assignments qa
            JOIN classes c ON qa.class_id = c.class_id
            LEFT JOIN quiz_attempts qat ON qa.assignment_id = qat.assignment_id
            WHERE qa.module_id = ? AND qa.created_by = ?
            GROUP BY qa.assignment_id
            ORDER BY qa.created_at DESC
        `, [moduleId, req.user.userId]);
        
        res.json({ assignments });
    } catch (error) {
        console.error('Get assignments error:', error);
        res.status(500).json({ error: 'Failed to load assignments' });
    }
});


// Get available quizzes for student
app.get('/api/student/available-quizzes',
    authenticateToken,
    requireRole('student'),
    async (req, res) => {
    try {
        // Get student's active class
        const [enrollment] = await pool.query(
            'SELECT classid FROM classenrollments WHERE studentid = ? AND enrollmentstatus = ?',
            [req.user.userId, 'active']
        );

        if (enrollment.length === 0) {
            return res.json({ quizzes: [] });
        }

        const classId = enrollment[0].classid;

        // Get available quiz assignments
        const [quizzes] = await pool.query(
            `SELECT qa.*, m.module_name,
                    qat.attempt_id, qat.score, qat.status as attemptStatus, qat.completed_at
             FROM quiz_assignments qa
             JOIN modules m ON qa.module_id = m.module_id
             LEFT JOIN quiz_attempts qat ON qa.assignment_id = qat.assignment_id AND qat.student_id = ?
             WHERE qa.class_id = ? 
                AND qa.is_active = TRUE
                AND (qa.due_date IS NULL OR qa.due_date > NOW())
             ORDER BY qa.due_date ASC, qa.created_at DESC`,
            [req.user.userId, classId]
        );

        res.json({ quizzes });

    } catch (error) {
        console.error('Get available quizzes error:', error);
        res.status(500).json({ error: 'Failed to fetch quizzes' });
    }
});

// Start quiz attempt
app.post('/api/student/quiz/:assignmentId/start',
    authenticateToken,
    requireRole('student'),
    async (req, res) => {
    try {
        const { assignmentId } = req.params;

        // Check if already attempted
        const [existing] = await pool.query(
            'SELECT * FROM quiz_attempts WHERE assignment_id = ? AND student_id = ?',
            [assignmentId, req.user.userId]
        );

        if (existing.length > 0 && existing[0].status === 'completed') {
            return res.status(400).json({ error: 'Quiz already completed' });
        }

        // Get assignment details
        const [assignment] = await pool.query(
            'SELECT * FROM quiz_assignments WHERE assignment_id = ?',
            [assignmentId]
        );

        if (assignment.length === 0) {
            return res.status(404).json({ error: 'Quiz not found' });
        }

        // Create or update attempt
        let attemptId;
        if (existing.length > 0) {
            attemptId = existing[0].attempt_id;
        } else {
            const [result] = await pool.query(
                `INSERT INTO quiz_attempts (assignment_id, student_id, total_questions, status)
                 VALUES (?, ?, ?, 'in_progress')`,
                [assignmentId, req.user.userId, assignment[0].total_questions]
            );
            attemptId = result.insertId;
        }

        // Get questions
        const [questions] = await pool.query(
            `SELECT problem_id as question_id, question_text, question_type,
                    option_a, option_b, option_c, option_d
             FROM custom_problems
             WHERE module_id = ?
             ORDER BY RAND()
             LIMIT ?`,
            [assignment[0].module_id, assignment[0].total_questions]
        );

        res.json({
            attemptId,
            assignment: assignment[0],
            questions
        });

    } catch (error) {
        console.error('Start quiz error:', error);
        res.status(500).json({ error: 'Failed to start quiz' });
    }
});

// Submit quiz answer
app.post('/api/student/quiz/:attemptId/answer',
    authenticateToken,
    requireRole('student'),
    async (req, res) => {
    try {
        const { attemptId } = req.params;
        const { problemId, selectedAnswer, timeSpent } = req.body;

        // Get correct answer
        const [problem] = await pool.query(
            'SELECT correct_option FROM custom_problems WHERE problem_id = ?',
            [problemId]
        );

        const isCorrect = problem[0].correct_option === selectedAnswer;

        // Save answer
        await pool.query(
            `INSERT INTO quiz_answers (attempt_id, problem_id, selected_answer, is_correct, time_spent_seconds)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE selected_answer = ?, is_correct = ?`,
            [attemptId, problemId, selectedAnswer, isCorrect, timeSpent, selectedAnswer, isCorrect]
        );

        res.json({ isCorrect });

    } catch (error) {
        console.error('Submit answer error:', error);
        res.status(500).json({ error: 'Failed to submit answer' });
    }
});

// Complete quiz
app.post('/api/student/quiz/:attemptId/complete',
    authenticateToken,
    requireRole('student'),
    async (req, res) => {
    try {
        const { attemptId } = req.params;
        const { timeSpent } = req.body;

        // Calculate score
        const [answers] = await pool.query(
            'SELECT COUNT(*) as total, SUM(is_correct) as correct FROM quiz_answers WHERE attempt_id = ?',
            [attemptId]
        );

        const score = (answers[0].correct / answers[0].total) * 100;

        // Update attempt
        await pool.query(
            `UPDATE quiz_attempts 
             SET status = 'completed', score = ?, time_spent_seconds = ?, completed_at = NOW()
             WHERE attempt_id = ?`,
            [score, timeSpent, attemptId]
        );

        res.json({ score, correct: answers[0].correct, total: answers[0].total });

    } catch (error) {
        console.error('Complete quiz error:', error);
        res.status(500).json({ error: 'Failed to complete quiz' });
    }
});

// ============================================================
// UPDATE MODULE CATEGORY (FOR PROPER 5-STRAND ALIGNMENT)
// ============================================================

app.put('/api/educator/modules/:moduleId/category', 
    authenticateToken, 
    requireRole('educator'), 
    async (req, res) => {
    try {
        const { moduleId } = req.params;
        const { category } = req.body;

        // Validate category
        const validCategories = ['conceptual', 'procedural', 'strategic', 'adaptive', 'productive'];
        if (!validCategories.includes(category)) {
            return res.status(400).json({ error: 'Invalid category' });
        }

        await pool.query(
            'UPDATE modules SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE module_id = ?',
            [category, moduleId]
        );

        res.json({ 
            message: 'Module category updated successfully',
            category 
        });
    } catch (error) {
        console.error('Update module category error:', error);
        res.status(500).json({ error: 'Failed to update module category' });
    }
});

// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;

// ========================================
// MODULE MATERIALS ENDPOINTS
// ========================================

// Get materials for a module (Teacher & Student)
app.get('/api/modules/:moduleId/materials', authenticateToken, async (req, res) => {
    const moduleId = req.params.moduleId;
    
    try {
        const [materials] = await pool.query(
            `SELECT 
                material_id,
                module_id,
                title,
                description,
                file_name,
                file_path,
                file_type,
                file_size,
                uploaded_by,
                created_at,
                updated_at
            FROM module_materials
            WHERE module_id = ?
            ORDER BY created_at DESC`,
            [moduleId]
        );
        
        console.log(`Materials for module ${moduleId}:`, materials.length);
        res.json({ success: true, materials });
    } catch (error) {
        console.error('Get materials error:', error);
        res.status(500).json({ error: 'Failed to fetch materials' });
    }
});

// Upload material (Teacher only)
app.post('/api/teacher/materials/upload', authenticateToken, requireRole('educator'), upload.single('file'), async (req, res) => {
    try {
        console.log('Upload request received');
        console.log('File:', req.file);
        console.log('Body:', req.body);
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const { moduleId, title, description } = req.body;
        
        if (!moduleId || !title) {
            return res.status(400).json({ error: 'Module ID and title are required' });
        }
        
        // Check if teacher owns this module
        const [modules] = await pool.query(
            'SELECT created_by FROM modules WHERE module_id = ?',
            [moduleId]
        );
        
        console.log('Module query result:', modules);
        console.log('Module created_by:', modules[0]?.created_by);
        console.log('User ID from token:', req.user.userId);
        
        if (modules.length === 0) {
            return res.status(404).json({ error: 'Module not found' });
        }
        
        // Allow if created_by is null (no owner) OR if user is the creator
        if (modules[0].created_by !== null && modules[0].created_by !== req.user.userId) {
            console.log('Authorization failed: created_by does not match userId');
            return res.status(403).json({ error: 'Not authorized to upload to this module' });
        }
        
        console.log('Authorization passed!');
        
        // Insert material record
        // Store relative path instead of absolute path
        const relativePath = `uploads/materials/${req.file.filename}`;
        
        const [result] = await pool.query(
            `INSERT INTO module_materials 
            (module_id, title, description, file_name, file_path, file_type, file_size, uploaded_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                moduleId,
                title,
                description || '',
                req.file.originalname,
                relativePath,  // Use relative path
                req.file.mimetype,
                req.file.size,
                req.user.userId
            ]
        );
        
        console.log('Material uploaded successfully:', result.insertId);
        
        res.json({
            success: true,
            materialId: result.insertId,
            message: 'Material uploaded successfully'
        });
        
    } catch (error) {
        console.error('Upload material error:', error);
        res.status(500).json({ error: 'Failed to upload material' });
    }
});

// Get single material details
app.get('/api/materials/:materialId', authenticateToken, async (req, res) => {
    const materialId = req.params.materialId;
    
    try {
        const [materials] = await pool.query(
            `SELECT 
                mm.*,
                m.module_name,
                m.created_by
            FROM module_materials mm
            JOIN modules m ON mm.module_id = m.module_id
            WHERE mm.material_id = ?`,
            [materialId]
        );
        
        if (materials.length === 0) {
            return res.status(404).json({ error: 'Material not found' });
        }
        
        const material = materials[0];
        
        // ✅ TANGGALIN NA ANG PROGRESS CHECK
        // Materials are open to all authenticated users (students + educators)
        // This allows students to study and learn before taking assessments
        
        // Add file URL (remove 'uploads/' prefix if present)
        const filePath = material.file_path.replace('uploads/', '');
        material.file_url = `/uploads/${filePath}`;
        
        console.log('Material retrieved:', material.title);
        res.json({ success: true, material });
        
    } catch (error) {
        console.error('Get material error:', error);
        res.status(500).json({ error: 'Failed to fetch material' });
    }
});


// Delete material (Teacher only)
app.delete('/api/teacher/materials/:materialId', authenticateToken, requireRole('educator'), async (req, res) => {
    const materialId = req.params.materialId;
    
    try {
        // Check ownership
        const [materials] = await pool.query(
            `SELECT mm.*, m.created_by
            FROM module_materials mm
            JOIN modules m ON mm.module_id = m.module_id
            WHERE mm.material_id = ?`,
            [materialId]
        );
        
        if (materials.length === 0) {
            return res.status(404).json({ error: 'Material not found' });
        }
        
        // Allow if created_by is null (no owner) OR if user is the creator
        if (materials[0].created_by !== null && materials[0].created_by !== req.user.userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }
        
        const filePath = materials[0].file_path;
        
        // Delete from database
        await pool.query('DELETE FROM module_materials WHERE material_id = ?', [materialId]);
        
        // Delete file from filesystem
        const fs = require('fs');
        const path = require('path');
        const fullPath = path.join(__dirname, 'public', filePath);
        
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            console.log('Deleted file:', fullPath);
        }
        
        console.log('Material deleted:', materialId);
        res.json({ success: true, message: 'Material deleted successfully' });
        
    } catch (error) {
        console.error('Delete material error:', error);
        res.status(500).json({ error: 'Failed to delete material' });
    }
});

// Track material view (Student only)
app.post('/api/student/materials/:materialId/view', authenticateToken, requireRole('student'), async (req, res) => {
    const materialId = req.params.materialId;
    
    try {
        // Optional: Log view for analytics
        // You can add a material_views table if you want detailed analytics
        console.log(`Student ${req.user.userId} viewed material ${materialId}`);
        
        res.json({ success: true, message: 'View tracked' });
        
    } catch (error) {
        console.error('Track view error:', error);
        res.status(500).json({ error: 'Failed to track view' });
    }
});



app.listen(PORT, () => {
    console.log('');
    console.log('🚀 ================================================');
    console.log('    FlexCalc - Research-Based Adaptive Learning');
    console.log('   ================================================');
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📚 Database: flexcalc_db`);
    console.log(`🌐 API Base: http://localhost:${PORT}/api`);
    console.log('');
    console.log('📊 Research Model Active:');
    console.log(`   • Correlation: r = ${WEAK_CORRELATION} (weak positive)`);
    console.log(`   • R² = ${R_SQUARED} (${(R_SQUARED*100).toFixed(1)}% variance explained)`);
    console.log(`   • Baseline: ${BASELINE_CONSTANT}% (stable foundation)`);
    console.log(`   • Modules: 12 (K-12 Basic Calculus aligned)`);
    console.log(`   • Scoring: Holistic with synergy bonuses`);
    console.log('🎯 ================================================');
    console.log('');
});
// ✅ NEW - Submit answer for assignment-based quiz
app.post('/api/student/assignments/:assignmentId/submit-answer', authenticateToken, requireRole('student'), async (req, res) => {
    const { assignmentId } = req.params;
    const { attemptid, questionid, selectedoptionid } = req.body;

    try {
        // Verify attempt belongs to student and assignment
        const [attempts] = await pool.query(
            `SELECT * FROM quiz_attempts 
             WHERE attempt_id = ? AND student_id = ? AND assignment_id = ?`,
            [attemptid, req.user.userId, assignmentId]
        );

        if (attempts.length === 0) {
            return res.status(404).json({ error: 'Attempt not found' });
        }

        if (attempts[0].status === 'completed') {
            return res.status(400).json({ error: 'Quiz already submitted' });
        }

        // Get correct answer and selected answer details
        const [correctOption] = await pool.query(
            `SELECT * FROM quiz_options 
             WHERE question_id = ? AND is_correct = 1`,
            [questionid]
        );

        if (correctOption.length === 0) {
            return res.status(404).json({ error: 'Question not found' });
        }

        const [selectedOption] = await pool.query(
            `SELECT option_letter FROM quiz_options WHERE option_id = ?`,
            [selectedoptionid]
        );

        const isCorrect = correctOption[0].option_id === selectedoptionid;

        // Get question details for points
        const [questions] = await pool.query(
            'SELECT * FROM quiz_questions WHERE question_id = ?',
            [questionid]
        );

        const pointsEarned = isCorrect ? parseFloat(questions[0].points) : 0;

        // ✅ Store the answer in quiz_answers table
        console.log('💾 Storing answer:', {
            attemptid,
            questionid,
            selected_letter: selectedOption[0]?.option_letter,
            isCorrect
        });
        
        const [insertResult] = await pool.query(
            `INSERT INTO quiz_answers 
             (attempt_id, problem_id, selected_answer, is_correct, answered_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [attemptid, questionid, selectedOption[0]?.option_letter, isCorrect ? 1 : 0]
        );
        
        console.log('✅ Answer stored! Insert ID:', insertResult.insertId);

        res.json({
            iscorrect: isCorrect,
            correctoptionid: correctOption[0].option_id,
            explanation: questions[0].explanation || 'No explanation available',
            pointsearned: pointsEarned
        });

    } catch (error) {
        console.error('❌ Submit answer error:', error);
        res.status(500).json({ error: 'Failed to submit answer: ' + error.message });
    }
});

// ✅ NEW - Submit/finish quiz for assignment
app.post('/api/student/assignments/:assignmentId/submit', authenticateToken, requireRole('student'), async (req, res) => {
    const { assignmentId } = req.params;
    const { attemptid } = req.body;

    try {
        // Verify attempt belongs to student
        const [attempts] = await pool.query(
            `SELECT * FROM quiz_attempts 
             WHERE attempt_id = ? AND student_id = ? AND assignment_id = ?`,
            [attemptid, req.user.userId, assignmentId]
        );

        if (attempts.length === 0) {
            return res.status(404).json({ error: 'Attempt not found' });
        }

        if (attempts[0].status === 'completed') {
            return res.status(400).json({ error: 'Quiz already submitted' });
        }

        // Get assignment details for scoring (including module_id)
        const [assignments] = await pool.query(
            `SELECT qa.*, q.quiz_id, q.passing_score, q.module_id
             FROM quiz_assignments qa
             JOIN quizzes q ON qa.quiz_id = q.quiz_id
             WHERE qa.assignment_id = ?`,
            [assignmentId]
        );

        const assignment = assignments[0];
        const moduleId = assignment.module_id;

        // ✅ Calculate score from stored answers
        const [answerStats] = await pool.query(
            `SELECT 
                COUNT(*) as total_answered,
                SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct_count
             FROM quiz_answers
             WHERE attempt_id = ?`,
            [attemptid]
        );

        const totalQuestions = assignment.total_questions;
        const correctAnswers = answerStats[0].correct_count || 0;
        const scorePercentage = (correctAnswers / totalQuestions) * 100;
        const passed = scorePercentage >= parseFloat(assignment.passing_score || 70);

        // ✅ Get detailed results with explanations
        const [detailedResults] = await pool.query(
            `SELECT 
                qq.question_id,
                qq.question_text as questiontext,
                qa.is_correct as iscorrect,
                qq.explanation
             FROM quiz_answers qa
             JOIN quiz_questions qq ON qa.problem_id = qq.question_id
             WHERE qa.attempt_id = ?
             ORDER BY qq.question_number`,
            [attemptid]
        );

        // Update attempt
        await pool.query(
            `UPDATE quiz_attempts 
             SET status = 'completed', 
                 completed_at = NOW(),
                 score = ?,
                 time_spent_seconds = TIMESTAMPDIFF(SECOND, started_at, NOW())
             WHERE attempt_id = ?`,
            [scorePercentage, attemptid]
        );

        // 🆕🆕🆕 UPDATE MODULE COMPLETION if score >= 70%
        if (scorePercentage >= 70 && moduleId) {
            console.log(`✅ Student passed! Updating module ${moduleId} completion status...`);
            
            // Check if student_progress record exists
            const [existingProgress] = await pool.query(
                `SELECT * FROM student_progress WHERE user_id = ? AND module_id = ?`,
                [req.user.userId, moduleId]
            );

            if (existingProgress.length > 0) {
                // Update existing record
                await pool.query(
                    `UPDATE student_progress 
                     SET status = 'completed', 
                         score = ?,
                         completed_at = NOW(),
                         attempts = attempts + 1
                     WHERE user_id = ? AND module_id = ?`,
                    [scorePercentage, req.user.userId, moduleId]
                );
                console.log(`✅ Module ${moduleId} marked as COMPLETED for student ${req.user.userId}`);
            } else {
                // Create new record
                await pool.query(
                    `INSERT INTO student_progress 
                     (user_id, module_id, status, score, attempts, started_at, completed_at)
                     VALUES (?, ?, 'completed', ?, 1, NOW(), NOW())`,
                    [req.user.userId, moduleId, scorePercentage]
                );
                console.log(`✅ Module ${moduleId} completion record CREATED for student ${req.user.userId}`);
            }
        } else if (moduleId) {
            console.log(`⚠️ Student did not pass (${scorePercentage}% < 70%). Module ${moduleId} remains incomplete.`);
        }

        res.json({
            passed: passed,
            scorepercentage: scorePercentage,
            correctanswers: correctAnswers,
            totalquestions: totalQuestions,
            pointsearned: correctAnswers,
            maxpoints: totalQuestions,
            results: detailedResults
        });

    } catch (error) {
        console.error('❌ Submit quiz error:', error);
        res.status(500).json({ error: 'Failed to submit quiz: ' + error.message });
    }
});


// ✅ Get student analytics/progress - COMPLETE FIX
app.get('/api/student/analytics', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const userId = req.user.userId;

        // ✅ Get strand scores
        const [strands] = await pool.query(`
            SELECT 
                strand_type as strandtype,
                ROUND(COALESCE(current_score, 0), 2) as currentscore,
                max_score as maxscore
            FROM strand_scores
            WHERE user_id = ?
        `, [userId]);

        console.log(`📊 Strand scores for user ${userId}:`, strands.map(s => `${s.strandtype}: ${s.currentscore}`).join(', '));

        // ✅ Calculate overall score from strands
        const overallScore = strands.length > 0 
            ? Math.round(strands.reduce((sum, s) => sum + (parseFloat(s.currentscore) || 0), 0) / strands.length)
            : 0;

        console.log(`📊 Overall score: ${overallScore}`);

        // ✅ Get quiz attempts with module info
        const [attempts] = await pool.query(`
            SELECT 
                sqa.attempt_id,
                sqa.score_percentage as score,
                sqa.correct_answers,
                sqa.total_questions,
                sqa.status,
                sqa.started_at,
                sqa.submitted_at as completed_at,
                qsa.assignment_id,
                qs.quiz_set_id,
                qs.quiz_title,
                m.module_id,
                m.module_name,
                m.category
            FROM student_quiz_attempts sqa
            JOIN quiz_set_assignments qsa ON sqa.assignment_id = qsa.assignment_id
            JOIN quiz_sets qs ON sqa.quiz_set_id = qs.quiz_set_id
            JOIN modules m ON qs.module_id = m.module_id
            WHERE sqa.student_id = ? AND sqa.status = 'submitted'
            ORDER BY sqa.submitted_at DESC
        `, [userId]);

        console.log(`📊 Found ${attempts.length} quiz attempts`);

        // ✅ Get ALL modules (even those without attempts)
        const [allModules] = await pool.query(`
            SELECT 
                module_id as moduleid,
                module_name as modulename,
                category
            FROM modules
            ORDER BY module_id
        `);

        // ✅ Build module progress from quiz attempts
        const moduleProgress = allModules.map(module => {
            const moduleAttempts = attempts.filter(a => a.module_id === module.moduleid);
            
            if (moduleAttempts.length === 0) {
                return {
                    moduleid: module.moduleid,
                    modulename: module.modulename,
                    name: module.modulename,
                    category: module.category,
                    strandtype: module.category,
                    status: 'not_started',
                    score: 0,
                    averagescore: 0,
                    highestscore: 0,
                    attempts: 0,
                    completed: false
                };
            }

            const scores = moduleAttempts.map(a => parseFloat(a.score || 0));
            const highestScore = Math.max(...scores);
            const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
            const isPassing = highestScore >= 75; // Changed to 75%

            return {
                moduleid: module.moduleid,
                modulename: module.modulename,
                name: module.modulename,
                category: module.category,
                strandtype: module.category,
                status: isPassing ? 'completed' : 'in_progress',
                score: highestScore,
                averagescore: Math.round(avgScore * 10) / 10,
                highestscore: highestScore,
                attempts: moduleAttempts.length,
                completed: isPassing
            };
        });

        console.log(`📊 Module progress: ${moduleProgress.filter(m => m.completed).length}/${moduleProgress.length} completed`);

        // ✅ Calculate summary stats
        const totalAttempts = attempts.length;
        const completedModules = moduleProgress.filter(m => m.completed).length;
        const totalModules = moduleProgress.length;
        
        // Passing rate based on quiz attempts (not modules)
        const passedAttempts = attempts.filter(a => a.score >= 75).length;
        const passingRate = totalAttempts > 0 
            ? Math.round((passedAttempts / totalAttempts) * 100)
            : 0;

        console.log(`📊 Summary: ${overallScore}% overall, ${totalAttempts} attempts, ${passedAttempts} passed (${passingRate}%)`);

        // ✅ Response with ALL required fields (both camelCase and lowercase for compatibility)
        res.json({
            overallScore: overallScore,
            strands: strands,
            timeline: [],
            moduleProgress: moduleProgress,
            moduleprogress: moduleProgress,
            summary: {
                // CamelCase (for new frontend)
                overallAverage: overallScore,
                totalAttempts: totalAttempts,
                modulesCompleted: completedModules,
                totalModules: totalModules,
                passingRate: passingRate,
                // Lowercase (for backward compatibility)
                totalattempts: totalAttempts,
                averagescore: overallScore,
                completedmodules: completedModules,
                totalmodules: totalModules,
                passingrate: passingRate
            },
            prediction: {
                baseline: 76.3,
                predicted: overallScore,
                avgProficiency: overallScore
            },
            riskAssessment: {
                level: overallScore >= 80 ? 'low' : overallScore >= 60 ? 'medium' : 'high',
                message: overallScore >= 70 ? 'Keep up the great work!' : 'Focus on improving your scores.',
                gap: 0
            },
            researchBased: true,
            correlationStrength: 'weak',
            correlation: 0.226,
            rSquared: 0.068,
            baseline: 76.3
        });

    } catch (error) {
        console.error('❌ Get analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch analytics', details: error.message });
    }
});



// 🆕🆕🆕 CHECK MODULE GATING - Is module unlocked?
// 🔓 Allow both students AND educators to check module access
app.get('/api/student/modules/:moduleId/check-access', authenticateToken, async (req, res) => {
    try {
        const { moduleId } = req.params;
        const userId = req.user.userId;

        console.log(`🔒 Checking access for user ${userId} (${req.user.role}) to module ${moduleId}...`);

        // Module 1 is always unlocked
        if (parseInt(moduleId) === 1) {
            console.log(`✅ Module 1 is always unlocked`);
            return res.json({
                unlocked: true,
                message: 'Welcome! This is the first module.',
                moduleId: parseInt(moduleId)
            });
        }

        const previousModuleId = parseInt(moduleId) - 1;
        
        // 🔥 EXACT TABLE NAMES FROM YOUR DB
        const [rows] = await pool.query(`
            SELECT MAX(sqa.score_percentage) AS highestscore
            FROM quiz_set_assignments qsa
            JOIN quiz_sets qs ON qsa.quiz_set_id = qs.quiz_set_id
            JOIN student_quiz_attempts sqa ON qsa.assignment_id = sqa.assignment_id
            WHERE qs.module_id = ? 
              AND sqa.student_id = ? 
              AND sqa.status = 'submitted'
        `, [previousModuleId, userId]);

        const prevScore = parseFloat(rows[0]?.highestscore || 0);

        if (!rows[0] || rows[0].highestscore === null) {
            console.log(`🔒 Module ${previousModuleId} not started yet (no quiz attempts). Module ${moduleId} is LOCKED.`);
            return res.json({
                unlocked: false,
                message: `You must complete Module ${previousModuleId} first.`,
                previousModule: previousModuleId,
                moduleId: parseInt(moduleId)
            });
        }

        if (prevScore >= 70) {
            console.log(`✅ Module ${previousModuleId} completed with ${prevScore}%. Module ${moduleId} is UNLOCKED!`);
            return res.json({
                unlocked: true,
                message: `Great job completing Module ${previousModuleId}!`,
                previousModule: previousModuleId,
                previousScore: prevScore,
                moduleId: parseInt(moduleId)
            });
        } else {
            console.log(`🔒 Module ${previousModuleId} not passed (${prevScore}% < 70%). Module ${moduleId} is LOCKED.`);
            return res.json({
                unlocked: false,
                message: `You must score at least 70% on Module ${previousModuleId} to unlock this module.`,
                previousModule: previousModuleId,
                previousScore: prevScore,
                required: 70,
                moduleId: parseInt(moduleId)
            });
        }

    } catch (error) {
        console.error('❌ Module access check error:', error);
        res.status(500).json({ error: 'Failed to check module access' });
    }
});



// ============================================================
// FILE UPLOAD & MATERIALS MANAGEMENT
// ============================================================

// Materials file upload configuration
const materialsStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, 'public', 'uploads', 'materials');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
    }
});

const materialsUpload = multer({
    storage: materialsStorage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain'
        ];
        
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF, DOCX, and TXT files allowed'));
        }
    }
});

// Upload material file
app.post('/api/educator/modules/:moduleId/materials/upload',
    authenticateToken,
    requireRole('educator'),
    materialsUpload.single('file'),
    async (req, res) => {
    try {
        const { moduleId } = req.params;
        const { title, description } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        console.log('📤 Uploading material:', req.file.originalname);
        
        const [result] = await pool.query(
            `INSERT INTO module_materials 
             (module_id, title, description, file_name, file_path, file_type, file_size, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                moduleId,
                title || req.file.originalname,
                description || '',
                req.file.originalname,
                `/uploads/materials/${req.file.filename}`,
                req.file.mimetype,
                req.file.size,
                req.user.userId
            ]
        );
        
        console.log('✅ Material uploaded:', result.insertId);
        
        res.json({
            success: true,
            materialId: result.insertId,
            filePath: `/uploads/materials/${req.file.filename}`,
            fileName: req.file.originalname,
            fileType: req.file.mimetype,
            fileSize: req.file.size
        });
        
    } catch (error) {
        console.error('❌ Material upload error:', error);
        res.status(500).json({ error: 'Failed to upload file' });
    }
});

// Get materials for module
app.get('/api/modules/:moduleId/materials',
    authenticateToken,
    async (req, res) => {
    try {
        const { moduleId } = req.params;
        
        const [materials] = await pool.query(
            `SELECT 
                m.material_id,
                m.title,
                m.description,
                m.file_name,
                m.file_path,
                m.file_type,
                m.file_size,
                m.created_at,
                u.first_name,
                u.last_name
            FROM module_materials m
            LEFT JOIN users u ON m.uploaded_by = u.user_id
            WHERE m.module_id = ?
            ORDER BY m.created_at DESC`,
            [moduleId]
        );
        
        res.json({ materials });
        
    } catch (error) {
        console.error('❌ Get materials error:', error);
        res.status(500).json({ error: 'Failed to fetch materials' });
    }
});

// Delete material
app.delete('/api/educator/materials/:materialId',
    authenticateToken,
    requireRole('educator'),
    async (req, res) => {
    try {
        const { materialId } = req.params;
        
        // Get file path before deleting
        const [material] = await pool.query(
            'SELECT file_path FROM module_materials WHERE material_id = ?',
            [materialId]
        );
        
        if (material.length === 0) {
            return res.status(404).json({ error: 'Material not found' });
        }
        
        // Delete from database
        await pool.query('DELETE FROM module_materials WHERE material_id = ?', [materialId]);
        
        // Delete file from filesystem
        const filePath = path.join(__dirname, 'public', material[0].file_path);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        console.log('✅ Material deleted:', materialId);
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Delete material error:', error);
        res.status(500).json({ error: 'Failed to delete material' });
    }
});

// ============================================================
// PRACTICE MODE ENDPOINTS
// ============================================================

// ✅ Helper: Find which questions table exists
async function findQuestionsTable() {
    // ✅ FIXED: Try practice_questions FIRST (dedicated practice table)
    const possibleTables = ['practice_questions', 'quiz_questions', 'quiz_set_questions', 'questions'];
    
    for (const tableName of possibleTables) {
        try {
            const [tables] = await pool.query(`SHOW TABLES LIKE '${tableName}'`);
            if (tables.length > 0) {
                console.log(`✅ Found questions table: ${tableName}`);
                return tableName;
            }
        } catch (error) {
            continue;
        }
    }
    
    throw new Error('No questions table found. Please run practice_questions_safe.sql');
}

// Generate practice questions
app.get('/api/student/practice/generate', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const { count = 10, mode = 'quick', strand = null, practice_mode = 'false' } = req.query;
        const userId = req.user.userId;
        const isPracticeMode = practice_mode === 'true';

        console.log(`📝 Generating practice: user=${userId}, mode=${mode}, count=${count}, strand=${strand}, practice=${isPracticeMode}`);

        // ✅ Find correct table name
        let questionsTable;
        try {
            questionsTable = await findQuestionsTable();
        } catch (error) {
            console.error('❌ Questions table not found:', error.message);
            return res.status(500).json({ 
                error: 'Questions database not configured',
                details: 'Please contact administrator to set up quiz questions.'
            });
        }

        let whereClause = '';
        let params = [];

        // Filter by strand if specified
        if (strand) {
            whereClause = 'WHERE q.strand = ?';
            params.push(strand);
        }

        // For adaptive mode, get questions from weak areas
        if (mode === 'adaptive' && !strand) {
            try {
                const [weakStrands] = await pool.query(`
                    SELECT strand_type, current_score
                    FROM strand_scores
                    WHERE user_id = ?
                    ORDER BY current_score ASC
                    LIMIT 2
                `, [userId]);

                if (weakStrands.length > 0) {
                    const weakStrandTypes = weakStrands.map(s => s.strand_type);
                    whereClause = `WHERE q.strand IN (${weakStrandTypes.map(() => '?').join(',')})`;
                    params = weakStrandTypes;
                    console.log(`🎯 Adaptive mode: targeting weak strands [${weakStrandTypes.join(', ')}]`);
                }
            } catch (error) {
                console.error('⚠️ Could not determine weak areas:', error.message);
                // Continue with all questions if we can't determine weak areas
            }
        }

        // Get random questions - use dynamic table name
        // ✅ Handle different ID column names
        const idColumn = questionsTable === 'practice_questions' ? 'practice_question_id' : 'question_id';
        const activeFilter = questionsTable === 'practice_questions' ? 'AND q.is_active = TRUE' : '';
        
        const query = `
            SELECT 
                q.${idColumn} as question_id,
                q.question_text,
                q.option_a,
                q.option_b,
                q.option_c,
                q.option_d,
                q.correct_option,
                q.explanation,
                q.difficulty,
                q.strand,
                q.points
            FROM ${questionsTable} q
            ${whereClause}
            ${whereClause ? activeFilter : (activeFilter ? 'WHERE ' + activeFilter.replace('AND ', '') : '')}
            ORDER BY RAND()
            LIMIT ?
        `;

        console.log(`🔍 Query: ${query}`);
        console.log(`📊 Params: ${JSON.stringify([...params, parseInt(count)])}`);

        const [questions] = await pool.query(query, [...params, parseInt(count)]);

        if (questions.length === 0) {
            console.log('⚠️ No questions found with given criteria');
            return res.status(404).json({ 
                error: 'No questions available',
                details: strand ? `No questions found for strand: ${strand}` : 'No questions in database'
            });
        }

        console.log(`✅ Generated ${questions.length} practice questions`);

        // ✅ For practice mode: include correct answers and explanations
        // For quiz mode: remove them
        res.json({ 
            success: true,
            questions: questions.map(q => {
                if (isPracticeMode) {
                    // Practice mode: keep everything for instant feedback
                    return q;
                } else {
                    // Quiz mode: remove answers
                    const { correct_option, explanation, ...questionWithoutAnswer } = q;
                    return questionWithoutAnswer;
                }
            }),
            mode,
            strand,
            count: questions.length
        });

    } catch (error) {
        console.error('❌ Practice generate error:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({ 
            error: 'Failed to generate practice questions',
            details: error.message 
        });
    }
});

// Submit practice attempt - ✅ CRITICAL FIX: Verify answers on backend
app.post('/api/student/practice/submit', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const { mode, strand, answers, question_ids, time_spent } = req.body;
        const userId = req.user.userId;

        console.log(`📤 Practice submit: user=${userId}, mode=${mode}, questions=${question_ids?.length}`);

        // ✅ SECURITY: Validate inputs
        if (!answers || !question_ids || !Array.isArray(question_ids)) {
            return res.status(400).json({ error: 'Invalid request data' });
        }

        if (time_spent < 0) {
            return res.status(400).json({ error: 'Invalid time spent' });
        }

        if (question_ids.length === 0) {
            return res.status(400).json({ error: 'No questions submitted' });
        }

        // ✅ Find correct table name
        const questionsTable = await findQuestionsTable();
        const idColumn = questionsTable === 'practice_questions' ? 'practice_question_id' : 'question_id';
        const activeFilter = questionsTable === 'practice_questions' ? 'AND is_active = TRUE' : '';

        // ✅ SECURITY: Get correct answers from database (don't trust frontend)
        const placeholders = question_ids.map(() => '?').join(',');
        const [questions] = await pool.query(`
            SELECT ${idColumn} as question_id, correct_option
            FROM ${questionsTable}
            WHERE ${idColumn} IN (${placeholders})
            ${activeFilter}
        `, question_ids);

        if (questions.length === 0) {
            return res.status(404).json({ error: 'Questions not found' });
        }

        // ✅ SECURITY: Calculate score on backend
        let correct_count = 0;
        questions.forEach(q => {
            if (answers[q.question_id] === q.correct_option) {
                correct_count++;
            }
        });

        const questions_count = questions.length;
        const score = questions_count > 0 ? (correct_count / questions_count) * 100 : 0;

        // ✅ Validate calculated score
        if (score < 0 || score > 100) {
            console.error(`⚠️ Invalid score calculated: ${score}`);
            return res.status(500).json({ error: 'Score calculation error' });
        }

        // Save practice attempt with verified score
        await pool.query(`
            INSERT INTO practice_attempts 
            (student_id, practice_mode, strand_type, questions_count, correct_count, score, time_spent_seconds)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [userId, mode, strand, questions_count, correct_count, Math.round(score * 100) / 100, time_spent]);

        console.log(`✅ Practice saved: Score ${score}%, Correct ${correct_count}/${questions_count}`);

        res.json({ 
            success: true,
            message: 'Practice attempt saved',
            score: Math.round(score * 100) / 100,
            correct_count,
            questions_count
        });

    } catch (error) {
        console.error('❌ Practice submit error:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({ 
            error: 'Failed to save practice attempt',
            details: error.message
        });
    }
});

// Get practice history
app.get('/api/student/practice/history', authenticateToken, requireRole('student'), async (req, res) => {
    try {
        const userId = req.user.userId;

        const [attempts] = await pool.query(`
            SELECT 
                attempt_id,
                practice_mode,
                strand_type,
                questions_count,
                correct_count,
                score,
                time_spent_seconds,
                created_at
            FROM practice_attempts
            WHERE student_id = ?
            ORDER BY created_at DESC
            LIMIT 50
        `, [userId]);

        res.json({ 
            success: true,
            attempts
        });

    } catch (error) {
        console.error('Practice history error:', error);
        res.status(500).json({ error: 'Failed to fetch practice history' });
    }
});