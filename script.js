// =========================
// IMPORT FIREBASE AUTH & SUPABASE
// =========================
import { auth } from './firebase.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { supabase } from './supabase.js';

const db = getFirestore();

// Upload file to Supabase
async function uploadFileToSupabase(file, path) {
    try {
        console.log('Starting upload to Supabase:', path + file.name);
        const { data, error } = await supabase.storage.from('files').upload(path + file.name, file, {
            upsert: true
        });
        if (error) {
            console.error('Supabase upload error:', error);
            throw error;
        }
        console.log('Upload successful, getting public URL');
        const { data: urlData } = supabase.storage.from('files').getPublicUrl(path + file.name);
        console.log('Public URL:', urlData.publicUrl);
        return urlData.publicUrl;
    } catch (error) {
        console.error('Upload error:', error);
        return null;
    }
}

// =========================
// THEME TOGGLE
// =========================
function initializeTheme() {
    const theme = localStorage.getItem("theme") || "dark";
    applyTheme(theme);

    // Ensure buttons are updated on load
    const darkBtn = document.getElementById("darkModeBtn") || document.getElementById("darkThemeBtn");
    const lightBtn = document.getElementById("lightModeBtn") || document.getElementById("lightThemeBtn");

    if (theme === "dark") {
        if (darkBtn) darkBtn.classList.add("active");
        if (lightBtn) lightBtn.classList.remove("active");
    } else {
        if (lightBtn) lightBtn.classList.add("active");
        if (darkBtn) darkBtn.classList.remove("active");
    }
}

function applyTheme(theme) {
    if (theme === "light") document.body.classList.add("light-mode");
    else document.body.classList.remove("light-mode");
    localStorage.setItem("theme", theme);

    const darkBtn = document.getElementById("darkModeBtn") || document.getElementById("darkThemeBtn");
    const lightBtn = document.getElementById("lightModeBtn") || document.getElementById("lightThemeBtn");

    // Remove active from all
    [document.getElementById("darkModeBtn"), document.getElementById("lightModeBtn"), 
     document.getElementById("darkThemeBtn"), document.getElementById("lightThemeBtn")].forEach(btn => {
        if (btn) btn.classList.remove("active");
    });

    // Add active to the correct button
    if (theme === "dark") {
        document.getElementById("darkModeBtn")?.classList.add("active");
        document.getElementById("darkThemeBtn")?.classList.add("active");
    } else {
        document.getElementById("lightModeBtn")?.classList.add("active");
        document.getElementById("lightThemeBtn")?.classList.add("active");
    }
}

// =========================
// LOGIN / SIGNUP MESSAGES
// =========================
function setMessage(id, msg, success = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
    el.style.color = success ? "#51cf66" : "#ff6b6b";
}

// =========================
// LOGIN FUNCTIONALITY
// =========================
function initializeLogin() {
    const loginForm = document.getElementById("loginForm");
    loginForm?.addEventListener("submit", async e => {
        e.preventDefault();
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value.trim();

        if (!email || !password) {
            setMessage("loginError", "Please fill in all fields");
            return;
        }

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // Fetch user role and course from Firestore (check "users" first, then "students" for backward compatibility)
            let userDoc = await getDoc(doc(db, "users", user.uid));
            let userRole = 'student';
            let userCourse = '';
            if (userDoc.exists()) {
                const data = userDoc.data();
                userRole = data.role || 'student';
                userCourse = data.course || '';
            } else {
                // Check "students" collection for old signups
                userDoc = await getDoc(doc(db, "students", user.uid));
                if (userDoc.exists()) {
                    const data = userDoc.data();
                    userRole = data.role || 'student';
                    userCourse = data.course || '';
                }
            }

            // Store logged-in user in localStorage
            localStorage.setItem("isLoggedIn", "true");
            localStorage.setItem("userData", JSON.stringify({ id: user.uid, name: user.displayName || email, role: userRole, course: userCourse }));

            setMessage("loginSuccess", "Login successful! Redirecting...", true);
            setTimeout(() => location.href = "index.html", 1200);
        } catch (err) {
            setMessage("loginError", err.message);
        }
    });
}

// =========================
// SIGNUP FUNCTIONALITY
// =========================
function initializeSignup() {
    const signupForm = document.getElementById("signupForm");

    signupForm?.addEventListener("submit", async e => {
        e.preventDefault();

        const fullName = document.getElementById("fullName").value.trim();
        const email = document.getElementById("signupEmail").value.trim();
        const password = document.getElementById("signupPassword").value;
        const confirmPassword = document.getElementById("confirmPassword").value;
        const phone = document.getElementById("phone").value.trim();
        const course = document.getElementById("course").value.trim();
        const role = document.querySelector('input[name="role"]:checked').value;
        const accessCode = document.getElementById("accessCode").value.trim();

        if (!fullName || !email || !password || !confirmPassword || !course) {
            setMessage("signupMessage", "Please fill in all required fields");
            return;
        }

        if (password !== confirmPassword) {
            setMessage("signupMessage", "Passwords do not match");
            return;
        }

        if (password.length < 6) {
            setMessage("signupMessage", "Password must be at least 6 characters");
            return;
        }

        if (role === "instructor") {
            if (accessCode !== "INSTRUCTOR2026") {
                setMessage("signupMessage", "Invalid access code for Instructor");
                return;
            }
        }

        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            await updateProfile(user, { displayName: fullName });

            await setDoc(doc(db, "users", user.uid), {
                fullName,
                email,
                phone,
                course,
                role,
                createdAt: serverTimestamp()
            });

            setMessage("signupMessage", "Account created successfully! Redirecting...", true);
            setTimeout(() => window.location.href = "Login.html", 1500);

        } catch (err) {
            setMessage("signupMessage", err.message);
        }
    });
}

// =========================
// ROLE TOGGLE FUNCTIONALITY
// =========================
function initializeRoleToggle() {
    const roleRadios = document.querySelectorAll('input[name="role"]');
    const accessCodeGroup = document.getElementById('accessCodeGroup');

    roleRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.value === 'instructor') {
                accessCodeGroup.style.display = 'block';
            } else {
                accessCodeGroup.style.display = 'none';
            }
        });
    });
}

// =========================
// PASSWORD TOGGLE
// =========================
function initializePasswordToggles() {
    function togglePassword(inputId, iconId) {
        const input = document.getElementById(inputId);
        const icon = document.querySelector(`#${iconId} i`);
        if (!input || !icon) return;
        input.type = input.type === "password" ? "text" : "password";
        icon.classList.toggle("fa-eye-slash");
        icon.classList.toggle("fa-eye");
    }

    document.getElementById("togglePassword")?.addEventListener("click", () => togglePassword("password", "togglePassword"));
    document.getElementById("toggleSignupPassword")?.addEventListener("click", () => togglePassword("signupPassword", "toggleSignupPassword"));
    document.getElementById("toggleConfirmPassword")?.addEventListener("click", () => togglePassword("confirmPassword", "toggleConfirmPassword"));
}

// =========================
// DASHBOARD USER INFO
// =========================
function initializeDashboard() {
    const userData = JSON.parse(localStorage.getItem("userData"));
    if (!userData) return;

    const userNameEl = document.getElementById("headerUserName");
    const dashboardNameEl = document.getElementById("dashboardUserName");
    const greetingEl = document.getElementById("greetingMessage");

    if (userNameEl) userNameEl.textContent = userData.name;
    if (dashboardNameEl) dashboardNameEl.textContent = userData.name.split(" ")[0];

    if (greetingEl) {
        const hour = new Date().getHours();
        greetingEl.textContent = hour < 12 ? "Good morning 🌅" :
                                 hour < 17 ? "Good afternoon ☀️" :
                                             "Good evening 🌙";
    }
}

// =========================
// LOGOUT
// =========================
function logout(e) {
    if (e) e.preventDefault();
    localStorage.clear();
    location.href = "Login.html";
}

// =========================
// HELP PAGE FUNCTIONALITY
// =========================
function initializeHelp() {
    const faqItems = document.querySelectorAll('.faq-item');
    
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        if (!question) return;

        question.addEventListener('click', () => {
            const isActive = item.classList.contains('active');
            
            // Close all other items
            faqItems.forEach(otherItem => {
                otherItem.classList.remove('active');
            });

            // Toggle current item
            if (!isActive) {
                item.classList.add('active');
            }
        });
    });

    // Contact Form Handling (Visual only)
    const contactForm = document.getElementById('helpContactForm');
    contactForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const btn = contactForm.querySelector('.btn-submit');
        const originalText = btn.textContent;
        btn.textContent = 'Message Sent!';
        btn.style.background = '#4ade80';
        setTimeout(() => { btn.textContent = originalText; btn.style.background = ''; contactForm.reset(); }, 3000);
    });
}

// =========================
// SUBJECTS PAGE FUNCTIONALITY
// =========================
function initializeSubjects() {
    const listContainer = document.getElementById('subjectsList');
    const detailsContainer = document.getElementById('subjectDetailsPanel');
    const addBtn = document.getElementById('addSubjectBtn');
    const addModal = document.getElementById('addSubjectModal');
    const addForm = document.getElementById('addSubjectForm');
    const editModal = document.getElementById('editSubjectModal');
    const editForm = document.getElementById('editSubjectForm');
    const deleteBtn = document.getElementById('deleteSubjectBtn');

    if (!listContainer || !detailsContainer) return;

    // Get user role
    let userData = JSON.parse(localStorage.getItem("userData"));
    const userRole = userData ? userData.role : 'student';
    console.log('User role:', userRole); // Debug log

    // Hide add subject button for students
    if (userRole !== 'instructor') {
        addBtn.style.display = 'none';
    }

    // Get subjects from localStorage or use dummy data
    let subjects = JSON.parse(localStorage.getItem('subjects')) || [
        {
            name: "Mathematics",
            teacher: "Mr. Anderson",
            time: "08:00 AM - 09:30 AM",
            description: "Advanced Calculus and Algebra",
            tasks: [
                { title: "Complete Chapter 5 Exercises", dueDate: "2023-10-15", priority: "high", status: "pending", description: "Solve all exercises in Chapter 5", file: null, fileUrl: null }
            ],
            assignments: [
                { title: "Research Paper", dueDate: "2023-10-20", points: 100, status: "pending", instructions: "Write a 5-page research paper on Calculus", file: null, fileUrl: null, submissions: [] }
            ],
            lessons: [],
            quizzes: []
        },
        {
            name: "Physics",
            teacher: "Ms. Curie",
            time: "10:00 AM - 11:30 AM",
            description: "Fundamentals of Physics",
            tasks: [],
            assignments: [],
            lessons: [],
            quizzes: []
        },
        {
            name: "Computer Science",
            teacher: "Mr. Turing",
            time: "01:00 PM - 02:30 PM",
            description: "Algorithms and Data Structures",
            tasks: [],
            assignments: [],
            lessons: [],
            quizzes: []
        }
    ];

    // Load subjects from Firestore if user is logged in
    if (userData && userData.course) {
        loadSubjectsFromFirestore(userData.course);
        // Enable realtime updates for all users (instructors and students) with debouncing
        setupRealtimeSubjects(userData.course);
    }

    // Dummy lessons data
    const dummyLessons = [
        { title: "Introduction to the Course", duration: "45 mins", status: "Completed" },
        { title: "Chapter 1: Fundamentals", duration: "1 hr 20 mins", status: "In Progress" },
        { title: "Chapter 2: Advanced Concepts", duration: "55 mins", status: "Locked" },
        { title: "Midterm Review", duration: "2 hrs", status: "Locked" }
    ];

    // -------------------------
    // RENDER SUBJECTS
    // -------------------------
    function renderSubjects() {
        listContainer.innerHTML = subjects.map((sub, index) => `
            <div class="subject-list-item" data-index="${index}">
                <h4>${sub.name}</h4>
                <p><i class="fas fa-chalkboard-teacher"></i> ${sub.teacher}</p>
            </div>
        `).join('');

        // Add click listeners
        document.querySelectorAll('.subject-list-item').forEach(item => {
            item.addEventListener('click', () => {
                // Remove active class from all
                document.querySelectorAll('.subject-list-item').forEach(i => i.classList.remove('active'));
                // Add active to clicked
                item.classList.add('active');
                // Show details
                renderSubjectDetails(item.dataset.index);
            });
        });
    }

    // -------------------------
    // RENDER DETAILS
    // -------------------------
    function renderSubjectDetails(index) {
        const sub = subjects[index];
        if (!sub) return;

        const isInstructor = userRole === 'instructor';
        console.log('User role in renderSubjectDetails:', userRole); // Debug log
        console.log('Rendering for instructor:', isInstructor); // Debug log

        detailsContainer.innerHTML = `
            <div class="detail-header">
                <h2>${sub.name}</h2>
                <div class="detail-meta">
                    <span><i class="fas fa-chalkboard-teacher"></i> ${sub.teacher}</span>
                    <span><i class="fas fa-clock"></i> ${sub.time}</span>
                </div>
                <p class="detail-description">${sub.description || "No description available."}</p>
            ${isInstructor ? `
            <div class="detail-actions">
                <button class="btn-edit-subject" data-index="${index}">
                    <i class="fas fa-edit"></i> Edit
                </button>
                <button class="btn-sync-cloud" data-index="${index}">
                    <i class="fas fa-cloud-upload-alt"></i> Sync to Cloud
                </button>
            </div>
            ` : ''}
            </div>

            <div class="subject-tabs">
                <button class="tab-btn active" data-tab="tasks">Tasks</button>
                <button class="tab-btn" data-tab="assignments">Assignments</button>
                <button class="tab-btn" data-tab="lessons">Lessons</button>
                <button class="tab-btn" data-tab="quizzes">Quizzes</button>
            </div>

            <div class="tab-content active" id="tasks-tab">
                <div class="items-container">
                    <div class="items-header">
                        <h3><i class="fas fa-tasks"></i> Tasks</h3>
                        ${isInstructor ? `<button class="btn-add-item" data-type="task" data-subject-index="${index}">
                            <i class="fas fa-plus"></i> Add Task
                        </button>` : ''}
                    </div>
                    <div class="items-list">
                        ${sub.tasks.map((task, i) => `
                            <div class="item-card">
                                <div class="item-info">
                                    <h4>${task.title}</h4>
                                    <p>Due: ${task.dueDate} | Priority: ${task.priority} | Status: ${task.status}</p>
                                    <p>${task.description}</p>
                                    ${task.file ? `<p><i class="fas fa-paperclip"></i> <a href="${task.fileUrl}" target="_blank">${task.file}</a></p>` : ''}
                                </div>
                                ${isInstructor ? `
                                <div class="item-actions">
                                    <button class="btn-edit-item" data-type="task" data-item-index="${i}" data-subject-index="${index}">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn-delete-item" data-type="task" data-item-index="${i}" data-subject-index="${index}">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <div class="tab-content" id="assignments-tab">
                <div class="items-container">
                    <div class="items-header">
                        <h3><i class="fas fa-clipboard-list"></i> Assignments</h3>
                        ${isInstructor ? `<button class="btn-add-item" data-type="assignment" data-subject-index="${index}">
                            <i class="fas fa-plus"></i> Add Assignment
                        </button>` : ''}
                    </div>
                    <div class="items-list">
                        ${sub.assignments.map((assignment, i) => `
                            <div class="item-card">
                                <div class="item-info">
                                    <h4>${assignment.title}</h4>
                                    <p>Due: ${assignment.dueDate} | Points: ${assignment.points} | Status: ${assignment.status}</p>
                                    <p>${assignment.instructions}</p>
                                    ${assignment.file ? `<p><i class="fas fa-paperclip"></i> <a href="${assignment.fileUrl}" target="_blank">${assignment.file}</a></p>` : ''}
                                    ${!isInstructor ? `
                                    <div class="student-actions">
                                        <button class="btn-submit-assignment" data-assignment-index="${i}" data-subject-index="${index}">
                                            <i class="fas fa-upload"></i> Submit Assignment
                                        </button>
                                        ${assignment.submissions && assignment.submissions.find(s => s.studentId === userData.id) ? '<p><i class="fas fa-check"></i> Submitted</p>' : ''}
                                    </div>
                                    ` : `
                                    <div class="instructor-actions">
                                        <button class="btn-view-submissions" data-assignment-index="${i}" data-subject-index="${index}">
                                            <i class="fas fa-eye"></i> View Submissions (${assignment.submissions ? assignment.submissions.length : 0})
                                        </button>
                                    </div>
                                    `}
                                </div>
                                ${isInstructor ? `
                                <div class="item-actions">
                                    <button class="btn-edit-item" data-type="assignment" data-item-index="${i}" data-subject-index="${index}">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn-delete-item" data-type="assignment" data-item-index="${i}" data-subject-index="${index}">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <div class="tab-content" id="lessons-tab">
                <div class="items-container">
                    <div class="items-header">
                        <h3><i class="fas fa-book-open"></i> Lessons</h3>
                        ${isInstructor ? `<button class="btn-add-item" data-type="lesson" data-subject-index="${index}">
                            <i class="fas fa-plus"></i> Add Lesson
                        </button>` : ''}
                    </div>
                    <div class="items-list">
                        ${sub.lessons.map((lesson, i) => `
                            <div class="item-card">
                                <div class="lesson-info">
                                    <h4>${lesson.title}</h4>
                                    <p><i class="fas fa-clock"></i> ${lesson.duration} • ${lesson.status}</p>
                                    <p>${lesson.content}</p>
                                    ${lesson.file ? `<p><i class="fas fa-paperclip"></i> <a href="${lesson.fileUrl}" target="_blank">${lesson.file}</a></p>` : ''}
                                </div>
                                ${isInstructor ? `
                                <div class="item-actions">
                                    <button class="btn-edit-item" data-type="lesson" data-item-index="${i}" data-subject-index="${index}">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn-delete-item" data-type="lesson" data-item-index="${i}" data-subject-index="${index}">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <div class="tab-content" id="quizzes-tab">
                <div class="items-container">
                    <div class="items-header">
                        <h3><i class="fas fa-question-circle"></i> Quizzes</h3>
                        ${isInstructor ? `<button class="btn-add-item" data-type="quiz" data-subject-index="${index}">
                            <i class="fas fa-plus"></i> Add Quiz
                        </button>` : ''}
                    </div>
                    <div class="items-list">
                        ${sub.quizzes.length > 0 ? sub.quizzes.map((quiz, i) => `
                            <div class="item-card">
                                <div class="item-info">
                                    <h4>${quiz.title}</h4>
                                    <p>Due: ${quiz.dueDate} | Points: ${quiz.points} | Status: ${quiz.status}</p>
                                    <p>${quiz.instructions}</p>
                                </div>
                                ${isInstructor ? `
                                <div class="item-actions">
                                    <button class="btn-edit-item" data-type="quiz" data-item-index="${i}" data-subject-index="${index}">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn-delete-item" data-type="quiz" data-item-index="${i}" data-subject-index="${index}">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                                ` : ''}
                            </div>
                        `).join('') : '<p>No quizzes available yet.</p>'}
                    </div>
                </div>
            </div>
        `;

        // Add click listener for Edit button in details
        document.querySelector('.btn-edit-subject')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditModal(e.target.closest('.btn-edit-subject').dataset.index);
        });

        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.tab + '-tab').classList.add('active');
            });
        });

        // Add click listeners for Add Item buttons
        document.querySelectorAll('.btn-add-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = btn.dataset.type;
                const subjectIndex = parseInt(btn.dataset.subjectIndex);
                openAddItemModal(subjectIndex, type);
            });
        });

        // Add click listeners for Edit Item buttons
        document.querySelectorAll('.btn-edit-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = btn.dataset.type;
                const itemIndex = parseInt(btn.dataset.itemIndex);
                const subjectIndex = parseInt(btn.dataset.subjectIndex);
                openEditItemModal(subjectIndex, type, itemIndex);
            });
        });

        // Add click listeners for Delete Item buttons
        document.querySelectorAll('.btn-delete-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = btn.dataset.type;
                const itemIndex = parseInt(btn.dataset.itemIndex);
                const subjectIndex = parseInt(btn.dataset.subjectIndex);
                deleteItem(subjectIndex, type, itemIndex);
            });
        });

        // Add click listeners for Submit Assignment buttons
        document.querySelectorAll('.btn-submit-assignment').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const assignmentIndex = parseInt(btn.dataset.assignmentIndex);
                const subjectIndex = parseInt(btn.dataset.subjectIndex);
                openSubmitAssignmentModal(subjectIndex, assignmentIndex);
            });
        });

        // Add click listeners for View Submissions buttons
        document.querySelectorAll('.btn-view-submissions').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const assignmentIndex = parseInt(btn.dataset.assignmentIndex);
                const subjectIndex = parseInt(btn.dataset.subjectIndex);
                viewSubmissions(subjectIndex, assignmentIndex);
            });
        });

        // Add click listener for Sync to Cloud button
        document.querySelectorAll('.btn-sync-cloud').forEach(btn => {
            btn.addEventListener('click', () => {
                saveSubjects(false); // Save without auto-sync to avoid double save
                saveSubjectsToFirestore();
            });
        });
    }

    // -------------------------
    // OPEN ADD MODAL
    // -------------------------
    addBtn?.addEventListener('click', () => {
        addModal.style.display = 'block';
    });

    // -------------------------
    // OPEN EDIT MODAL
    // -------------------------
    function openEditModal(index) {
        const sub = subjects[index];
        if (!sub) return;

        document.getElementById('editSubjectIndex').value = index;
        document.getElementById('editSubjectName').value = sub.name;
        document.getElementById('editTeacherName').value = sub.teacher;
        document.getElementById('editSubjectTime').value = sub.time;
        document.getElementById('editSubjectDescription').value = sub.description || '';

        editModal.style.display = 'block';
    }





    // -------------------------
    // CLOSE MODALS
    // -------------------------
    function closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
    }

    document.querySelectorAll('.modal .close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    window.addEventListener('click', e => {
        if (e.target.classList.contains('modal')) {
            closeAllModals();
        }
    });





    // -------------------------
    // ADD SUBJECT (FORM)
    // -------------------------
    addForm?.addEventListener('submit', async e => {
        e.preventDefault();

        const subject = {
            name: document.getElementById('newSubjectName').value.trim(),
            teacher: document.getElementById('newTeacherName').value.trim(),
            time: document.getElementById('newSubjectTime').value.trim(),
            description: document.getElementById('newSubjectDescription').value.trim(),
            lessons: [],
            tasks: [],
            assignments: [],
            quizzes: []
        };

        subjects.push(subject);
        saveSubjects();
        renderSubjects();

        addForm.reset();
        addModal.style.display = 'none';
    });

    // -------------------------
    // EDIT SUBJECT (FORM)
    // -------------------------
    editForm?.addEventListener('submit', e => {
        e.preventDefault();

        const index = parseInt(document.getElementById('editSubjectIndex').value);

        subjects[index] = {
            name: document.getElementById('editSubjectName').value.trim(),
            teacher: document.getElementById('editTeacherName').value.trim(),
            time: document.getElementById('editSubjectTime').value.trim(),
            description: document.getElementById('editSubjectDescription').value.trim()
        };

        saveSubjects();
        renderSubjects();
        renderSubjectDetails(index);

        closeAllModals();
    });

    // -------------------------
    // DELETE SUBJECT
    // -------------------------
    deleteBtn?.addEventListener('click', () => {
        const index = parseInt(document.getElementById('editSubjectIndex').value);

        if (confirm('Are you sure you want to delete this subject?')) {
            subjects.splice(index, 1);
            saveSubjects();
            renderSubjects();

            // Show empty state
            detailsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-book-open"></i>
                    <p>Select a subject from the list to view details, tasks, assignments, and lessons.</p>
                </div>
            `;

            closeAllModals();
        }
    });

    // -------------------------
    // ADD TASK (FORM)
    // -------------------------
    const addTaskForm = document.getElementById('addTaskForm');
    addTaskForm?.addEventListener('submit', async e => {
        e.preventDefault();

        const subjectIndex = parseInt(document.getElementById('taskSubjectIndex').value);
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const fileInput = document.getElementById('newTaskFile');
        let fileName = null;
        let fileUrl = null;

        if (fileInput.files[0]) {
            const file = fileInput.files[0];
            fileName = file.name;
            fileUrl = await uploadFileToSupabase(file, `subjects/${sub.name}/tasks/`);
        }

        const task = {
            title: document.getElementById('newTaskTitle').value.trim(),
            dueDate: document.getElementById('newTaskDueDate').value,
            priority: document.getElementById('newTaskPriority').value,
            status: 'pending',
            description: document.getElementById('newTaskDescription').value.trim(),
            file: fileName,
            fileUrl: fileUrl
        };

        sub.tasks.push(task);
        saveSubjects();
        renderSubjectDetails(subjectIndex);

        addTaskForm.reset();
        document.getElementById('addTaskModal').style.display = 'none';
    });

    // -------------------------
    // EDIT TASK (FORM)
    // -------------------------
    const editTaskForm = document.getElementById('editTaskForm');
    editTaskForm?.addEventListener('submit', async e => {
        e.preventDefault();

        const itemIndex = parseInt(document.getElementById('editTaskIndex').value);
        const subjectIndex = parseInt(document.getElementById('editTaskSubjectIndex').value);
        const sub = subjects[subjectIndex];
        if (!sub || !sub.tasks[itemIndex]) return;

        const fileInput = document.getElementById('editTaskFile');
        let fileName = sub.tasks[itemIndex].file;
        let fileUrl = sub.tasks[itemIndex].fileUrl;

        if (fileInput.files[0]) {
            const file = fileInput.files[0];
            fileName = file.name;
            fileUrl = await uploadFileToSupabase(file, `subjects/${sub.name}/tasks/`);
        }

        sub.tasks[itemIndex] = {
            title: document.getElementById('editTaskTitle').value.trim(),
            dueDate: document.getElementById('editTaskDueDate').value,
            priority: document.getElementById('editTaskPriority').value,
            status: document.getElementById('editTaskStatus').value,
            description: document.getElementById('editTaskDescription').value.trim(),
            file: fileName,
            fileUrl: fileUrl
        };

        saveSubjects();
        renderSubjectDetails(subjectIndex);

        closeAllModals();
    });

    // -------------------------
    // DELETE TASK
    // -------------------------
    const deleteTaskBtn = document.getElementById('deleteTaskBtn');
    deleteTaskBtn?.addEventListener('click', () => {
        const itemIndex = parseInt(document.getElementById('editTaskIndex').value);
        const subjectIndex = parseInt(document.getElementById('editTaskSubjectIndex').value);
        deleteItem(subjectIndex, 'task', itemIndex);
    });

    // -------------------------
    // ADD ASSIGNMENT (FORM)
    // -------------------------
    const addAssignmentForm = document.getElementById('addAssignmentForm');
    addAssignmentForm?.addEventListener('submit', async e => {
        e.preventDefault();

        const subjectIndex = parseInt(document.getElementById('assignmentSubjectIndex').value);
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const fileInput = document.getElementById('newAssignmentFile');
        let fileName = null;
        let fileUrl = null;

        if (fileInput.files[0]) {
            const file = fileInput.files[0];
            fileName = file.name;
            fileUrl = await uploadFileToSupabase(file, `subjects/${sub.name}/assignments/`);
        }

        const assignment = {
            title: document.getElementById('newAssignmentTitle').value.trim(),
            dueDate: document.getElementById('newAssignmentDueDate').value,
            points: parseInt(document.getElementById('newAssignmentPoints').value),
            status: document.getElementById('newAssignmentStatus').value,
            instructions: document.getElementById('newAssignmentInstructions').value.trim(),
            file: fileName,
            fileUrl: fileUrl,
            submissions: []
        };

        sub.assignments.push(assignment);
        saveSubjects();
        renderSubjectDetails(subjectIndex);

        addAssignmentForm.reset();
        document.getElementById('addAssignmentModal').style.display = 'none';
    });

    // -------------------------
    // EDIT ASSIGNMENT (FORM)
    // -------------------------
    const editAssignmentForm = document.getElementById('editAssignmentForm');
    editAssignmentForm?.addEventListener('submit', async e => {
        e.preventDefault();

        const itemIndex = parseInt(document.getElementById('editAssignmentIndex').value);
        const subjectIndex = parseInt(document.getElementById('editAssignmentSubjectIndex').value);
        const sub = subjects[subjectIndex];
        if (!sub || !sub.assignments[itemIndex]) return;

        const fileInput = document.getElementById('editAssignmentFile');
        let fileName = sub.assignments[itemIndex].file;
        let fileUrl = sub.assignments[itemIndex].fileUrl;

        if (fileInput.files[0]) {
            const file = fileInput.files[0];
            fileName = file.name;
            fileUrl = await uploadFileToSupabase(file, `subjects/${sub.name}/assignments/`);
        }

        sub.assignments[itemIndex] = {
            title: document.getElementById('editAssignmentTitle').value.trim(),
            dueDate: document.getElementById('editAssignmentDueDate').value,
            points: parseInt(document.getElementById('editAssignmentPoints').value),
            status: document.getElementById('editAssignmentStatus').value,
            instructions: document.getElementById('editAssignmentInstructions').value.trim(),
            file: fileName,
            fileUrl: fileUrl,
            submissions: sub.assignments[itemIndex].submissions || []
        };

        saveSubjects();
        renderSubjectDetails(subjectIndex);

        closeAllModals();
    });

    // -------------------------
    // DELETE ASSIGNMENT
    // -------------------------
    const deleteAssignmentBtn = document.getElementById('deleteAssignmentBtn');
    deleteAssignmentBtn?.addEventListener('click', () => {
        const itemIndex = parseInt(document.getElementById('editAssignmentIndex').value);
        const subjectIndex = parseInt(document.getElementById('editAssignmentSubjectIndex').value);
        deleteItem(subjectIndex, 'assignment', itemIndex);
    });

    // -------------------------
    // ADD LESSON (FORM)
    // -------------------------
    const addLessonForm = document.getElementById('addLessonForm');
    addLessonForm?.addEventListener('submit', async e => {
        e.preventDefault();

        const subjectIndex = parseInt(document.getElementById('lessonSubjectIndex').value);
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const fileInput = document.getElementById('newLessonFile');
        let fileName = null;
        let fileUrl = null;

        if (fileInput.files[0]) {
            const file = fileInput.files[0];
            fileName = file.name;
            fileUrl = await uploadFileToSupabase(file, `subjects/${sub.name}/lessons/`);
        }

        const lesson = {
            title: document.getElementById('newLessonTitle').value.trim(),
            duration: document.getElementById('newLessonDuration').value.trim(),
            status: document.getElementById('newLessonStatus').value,
            content: document.getElementById('newLessonContent').value.trim(),
            file: fileName,
            fileUrl: fileUrl
        };

        sub.lessons.push(lesson);
        saveSubjects();
        renderSubjectDetails(subjectIndex);

        addLessonForm.reset();
        document.getElementById('addLessonModal').style.display = 'none';
    });

    // -------------------------
    // EDIT LESSON (FORM)
    // -------------------------
    const editLessonForm = document.getElementById('editLessonForm');
    editLessonForm?.addEventListener('submit', async e => {
        e.preventDefault();

        const itemIndex = parseInt(document.getElementById('editLessonIndex').value);
        const subjectIndex = parseInt(document.getElementById('editLessonSubjectIndex').value);
        const sub = subjects[subjectIndex];
        if (!sub || !sub.lessons[itemIndex]) return;

        const fileInput = document.getElementById('editLessonFile');
        let fileName = sub.lessons[itemIndex].file;
        let fileUrl = sub.lessons[itemIndex].fileUrl;

        if (fileInput.files[0]) {
            const file = fileInput.files[0];
            fileName = file.name;
            fileUrl = await uploadFileToSupabase(file, `subjects/${sub.name}/lessons/`);
        }

        sub.lessons[itemIndex] = {
            title: document.getElementById('editLessonTitle').value.trim(),
            duration: document.getElementById('editLessonDuration').value.trim(),
            status: document.getElementById('editLessonStatus').value,
            content: document.getElementById('editLessonContent').value.trim(),
            file: fileName,
            fileUrl: fileUrl
        };

        saveSubjects();
        renderSubjectDetails(subjectIndex);

        closeAllModals();
    });

    // -------------------------
    // DELETE LESSON
    // -------------------------
    const deleteLessonBtn = document.getElementById('deleteLessonBtn');
    deleteLessonBtn?.addEventListener('click', () => {
        const itemIndex = parseInt(document.getElementById('editLessonIndex').value);
        const subjectIndex = parseInt(document.getElementById('editLessonSubjectIndex').value);
        deleteItem(subjectIndex, 'lesson', itemIndex);
    });

    // -------------------------
    // OPEN ADD ITEM MODAL
    // -------------------------
    function openAddItemModal(subjectIndex, type) {
        if (type === 'quiz') {
            // Custom modal for quiz
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'addQuizModal';
            modal.innerHTML = `
                <div class="modal-content">
                    <span class="close">&times;</span>
                    <div class="modal-body">
                        <h2>Add New Quiz</h2>
                        <form id="addQuizForm">
                            <input type="hidden" id="quizSubjectIndex" value="${subjectIndex}" />
                            <div class="form-group">
                                <label>Quiz Title</label>
                                <input type="text" id="newQuizTitle" required placeholder="e.g. Midterm Quiz" />
                            </div>
                            <div class="form-group">
                                <label>Due Date</label>
                                <input type="date" id="newQuizDueDate" required />
                            </div>
                            <div class="form-group">
                                <label>Points</label>
                                <input type="number" id="newQuizPoints" required placeholder="e.g. 50" />
                            </div>
                            <div class="form-group">
                                <label>Instructions</label>
                                <textarea id="newQuizInstructions" rows="4" placeholder="Quiz instructions..."></textarea>
                            </div>
                            <button type="submit" class="btn-add-subject">Add Quiz</button>
                        </form>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.style.display = 'block';

            modal.querySelector('.close').addEventListener('click', () => modal.remove());

            modal.querySelector('#addQuizForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const sub = subjects[subjectIndex];
                const quiz = {
                    title: document.getElementById('newQuizTitle').value.trim(),
                    dueDate: document.getElementById('newQuizDueDate').value,
                    points: parseInt(document.getElementById('newQuizPoints').value),
                    status: 'available',
                    instructions: document.getElementById('newQuizInstructions').value.trim()
                };
                sub.quizzes.push(quiz);
                saveSubjects();
                renderSubjectDetails(subjectIndex);
                modal.remove();
            });
        } else {
            const modalId = `add${type.charAt(0).toUpperCase() + type.slice(1)}Modal`;
            const modal = document.getElementById(modalId);
            if (!modal) return;

            document.getElementById(`${type}SubjectIndex`).value = subjectIndex;
            modal.style.display = 'block';
        }
    }

    // -------------------------
    // OPEN EDIT ITEM MODAL
    // -------------------------
    function openEditItemModal(subjectIndex, type, itemIndex) {
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const item = sub[`${type}s`][itemIndex];
        if (!item) return;

        if (type === 'quiz') {
            // Custom edit modal for quiz
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'editQuizModal';
            modal.innerHTML = `
                <div class="modal-content">
                    <span class="close">&times;</span>
                    <div class="modal-body">
                        <h2>Edit Quiz</h2>
                        <form id="editQuizForm">
                            <input type="hidden" id="editQuizIndex" value="${itemIndex}" />
                            <input type="hidden" id="editQuizSubjectIndex" value="${subjectIndex}" />
                            <div class="form-group">
                                <label>Quiz Title</label>
                                <input type="text" id="editQuizTitle" required value="${item.title}" />
                            </div>
                            <div class="form-group">
                                <label>Due Date</label>
                                <input type="date" id="editQuizDueDate" required value="${item.dueDate}" />
                            </div>
                            <div class="form-group">
                                <label>Points</label>
                                <input type="number" id="editQuizPoints" required value="${item.points}" />
                            </div>
                            <div class="form-group">
                                <label>Instructions</label>
                                <textarea id="editQuizInstructions" rows="4">${item.instructions}</textarea>
                            </div>
                            <div class="form-actions">
                                <button type="submit" class="btn-save">Save Changes</button>
                                <button type="button" class="btn-delete" id="deleteQuizBtn">Delete</button>
                            </div>
                        </form>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.style.display = 'block';

            modal.querySelector('.close').addEventListener('click', () => modal.remove());

            modal.querySelector('#editQuizForm').addEventListener('submit', (e) => {
                e.preventDefault();
                sub.quizzes[itemIndex] = {
                    title: document.getElementById('editQuizTitle').value.trim(),
                    dueDate: document.getElementById('editQuizDueDate').value,
                    points: parseInt(document.getElementById('editQuizPoints').value),
                    status: item.status,
                    instructions: document.getElementById('editQuizInstructions').value.trim()
                };
                saveSubjects();
                renderSubjectDetails(subjectIndex);
                modal.remove();
            });

            modal.querySelector('#deleteQuizBtn').addEventListener('click', () => {
                if (confirm('Are you sure you want to delete this quiz?')) {
                    sub.quizzes.splice(itemIndex, 1);
                    saveSubjects();
                    renderSubjectDetails(subjectIndex);
                    modal.remove();
                }
            });
        } else {
            const modalId = `edit${type.charAt(0).toUpperCase() + type.slice(1)}Modal`;
            const modal = document.getElementById(modalId);
            if (!modal) return;

            document.getElementById(`edit${type.charAt(0).toUpperCase() + type.slice(1)}Index`).value = itemIndex;
            document.getElementById(`edit${type.charAt(0).toUpperCase() + type.slice(1)}SubjectIndex`).value = subjectIndex;

            // Populate form fields based on type
            if (type === 'task') {
                document.getElementById('editTaskTitle').value = item.title;
                document.getElementById('editTaskDueDate').value = item.dueDate;
                document.getElementById('editTaskPriority').value = item.priority;
                document.getElementById('editTaskStatus').value = item.status;
                document.getElementById('editTaskDescription').value = item.description;
            } else if (type === 'assignment') {
                document.getElementById('editAssignmentTitle').value = item.title;
                document.getElementById('editAssignmentDueDate').value = item.dueDate;
                document.getElementById('editAssignmentPoints').value = item.points;
                document.getElementById('editAssignmentStatus').value = item.status;
                document.getElementById('editAssignmentInstructions').value = item.instructions;
            } else if (type === 'lesson') {
                document.getElementById('editLessonTitle').value = item.title;
                document.getElementById('editLessonDuration').value = item.duration;
                document.getElementById('editLessonStatus').value = item.status;
                document.getElementById('editLessonContent').value = item.content;
            }

            modal.style.display = 'block';
        }
    }

    // -------------------------
    // OPEN SUBMIT ASSIGNMENT MODAL
    // -------------------------
    function openSubmitAssignmentModal(subjectIndex, assignmentIndex) {
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const assignment = sub.assignments[assignmentIndex];
        if (!assignment) return;

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'submitAssignmentModal';
        modal.innerHTML = `
            <div class="modal-content">
                <span class="close">&times;</span>
                <div class="modal-body">
                    <h2>Submit Assignment: ${assignment.title}</h2>
                    <form id="submitAssignmentForm">
                        <input type="hidden" id="submitSubjectIndex" value="${subjectIndex}" />
                        <input type="hidden" id="submitAssignmentIndex" value="${assignmentIndex}" />
                        <div class="form-group">
                            <label>Upload Your Submission</label>
                            <input type="file" id="submitFile" required />
                        </div>
                        <button type="submit" class="btn-add-subject">Submit Assignment</button>
                    </form>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'block';

        modal.querySelector('.close').addEventListener('click', () => modal.remove());

        modal.querySelector('#submitAssignmentForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fileInput = document.getElementById('submitFile');
            if (!fileInput.files[0]) {
                alert('Please select a file to submit.');
                return;
            }

            const file = fileInput.files[0];
            console.log('Uploading file:', file.name);
            const fileUrl = await uploadFileToSupabase(file, `subjects/${sub.name}/assignments/submissions/${userData.id}/`);
            console.log('Upload result:', fileUrl);

            if (!fileUrl) {
                alert('File upload failed. Please try again.');
                return;
            }

            if (!assignment.submissions) assignment.submissions = [];
            assignment.submissions.push({
                studentId: userData.id,
                fileName: file.name,
                fileUrl: fileUrl,
                submittedAt: new Date().toISOString()
            });

            saveSubjects();
            renderSubjectDetails(subjectIndex);
            alert('Assignment submitted successfully!');
            modal.remove();
        });
    }

    // -------------------------
    // VIEW SUBMISSIONS
    // -------------------------
    function viewSubmissions(subjectIndex, assignmentIndex) {
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const assignment = sub.assignments[assignmentIndex];
        if (!assignment || !assignment.submissions) return;

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'viewSubmissionsModal';
        modal.innerHTML = `
            <div class="modal-content">
                <span class="close">&times;</span>
                <div class="modal-body">
                    <h2>Submissions for: ${assignment.title}</h2>
                    <div class="submissions-list">
                        ${assignment.submissions.map(submission => `
                            <div class="submission-item">
                                <p><strong>Student ID:</strong> ${submission.studentId}</p>
                                <p><strong>File:</strong> <a href="${submission.fileUrl}" target="_blank">${submission.fileName}</a></p>
                                <p><strong>Submitted At:</strong> ${new Date(submission.submittedAt).toLocaleString()}</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'block';

        modal.querySelector('.close').addEventListener('click', () => modal.remove());
    }

    // -------------------------
    // DELETE ITEM
    // -------------------------
    function deleteItem(subjectIndex, type, itemIndex) {
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const arrayName = `${type}s`;
        if (!sub[arrayName] || !sub[arrayName][itemIndex]) return;

        if (confirm(`Are you sure you want to delete this ${type}?`)) {
            sub[arrayName].splice(itemIndex, 1);
            saveSubjects();
            renderSubjectDetails(subjectIndex);
        }
    }

    // -------------------------
    // SAVE TO LOCALSTORAGE
    // -------------------------
    function saveSubjects(autoSync = true) {
        localStorage.setItem('subjects', JSON.stringify(subjects));
        // Auto-sync to Firestore immediately if user is instructor
        if (autoSync && userData && userData.course && userData.role === 'instructor') {
            saveSubjectsToFirestore();
        }
    }

    // -------------------------
    // LOAD SUBJECTS FROM FIRESTORE
    // -------------------------
    async function loadSubjectsFromFirestore(courseId) {
        try {
            const docRef = doc(db, "subjects", courseId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                subjects = docSnap.data().subjects || subjects;
                saveSubjects(); // Sync to localStorage
                renderSubjects();
            } else {
                // If no Firestore data, save local data to Firestore for first time
                saveSubjectsToFirestore();
            }
        } catch (error) {
            console.error("Error loading subjects from Firestore:", error);
        }
    }

    // -------------------------
    // SAVE SUBJECTS TO FIRESTORE
    // -------------------------
    async function saveSubjectsToFirestore() {
        if (!userData || !userData.course) {
            console.log("No course data, skipping Firestore save.");
            return;
        }

        try {
            // Limit to 10 subjects to avoid quota issues
            const limitedSubjects = subjects.slice(0, 10);
            await setDoc(doc(db, "subjects", userData.course), {
                subjects: limitedSubjects,
                lastUpdated: serverTimestamp()
            });
            console.log("Subjects synced to cloud successfully!");
        } catch (error) {
            console.error("Error saving subjects to Firestore:", error);
            // Don't show alert to avoid spam, just log
        }
    }

    // -------------------------
    // SETUP REALTIME SUBJECTS
    // -------------------------
    function setupRealtimeSubjects(courseId) {
        const docRef = doc(db, "subjects", courseId);
        onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                subjects = docSnap.data().subjects || subjects;
                saveSubjects(false); // Sync to localStorage without triggering another save
                renderSubjects();
                // Re-render current subject details if any
                const activeItem = document.querySelector('.subject-list-item.active');
                if (activeItem) {
                    renderSubjectDetails(activeItem.dataset.index);
                }
                console.log("Realtime update: Subjects refreshed from cloud.");
            }
        }, (error) => {
            console.error("Realtime listener error:", error);
        });
    }

    // Initial Render
    renderSubjects();
}

// =========================
// PROFILE PAGE FUNCTIONALITY
// =========================
function initializeProfile() {
    const editBtn = document.getElementById('editProfileBtn');
    const modal = document.getElementById('editProfileModal');
    const closeBtn = document.getElementById('closeModalBtn');
    const cancelBtn = document.getElementById('cancelModalBtn');
    const editForm = document.getElementById('editForm');

    if (!editBtn || !modal || !editForm) return;

    // Load saved profile data
    const savedProfile = localStorage.getItem('userProfile');
    if (savedProfile) {
        const data = JSON.parse(savedProfile);
        updateProfileUI(data);
    }

    // Open Modal
    editBtn.addEventListener('click', () => {
        // Populate form with current values
        document.getElementById('editName').value = document.getElementById('fullName').textContent;
        document.getElementById('editEmail').value = document.getElementById('infoEmail').textContent;
        document.getElementById('editPhone').value = document.getElementById('infoPhone').textContent;
        document.getElementById('editGender').value = document.getElementById('infoGender').textContent;
        
        // Handle Date (Convert "March 15, 2003" to "2003-03-15")
        const dobText = document.getElementById('infoDOB').textContent;
        const dateObj = new Date(dobText);
        if (!isNaN(dateObj.getTime())) {
             document.getElementById('editDOB').value = dateObj.toISOString().split('T')[0];
        }
        
        modal.style.display = 'block';
    });

    // Close Modal
    const closeModal = () => modal.style.display = 'none';
    if(closeBtn) closeBtn.addEventListener('click', closeModal);
    if(cancelBtn) cancelBtn.addEventListener('click', closeModal);
    window.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Save Changes
    editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const newData = {
            fullName: document.getElementById('editName').value,
            email: document.getElementById('editEmail').value,
            phone: document.getElementById('editPhone').value,
            dob: document.getElementById('editDOB').value,
            gender: document.getElementById('editGender').value
        };

        // Format Date for display (YYYY-MM-DD to Month DD, YYYY)
        const dateObj = new Date(newData.dob);
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        const displayDate = !isNaN(dateObj.getTime()) ? dateObj.toLocaleDateString('en-US', options) : newData.dob;
        
        const uiData = { ...newData, dob: displayDate };

        updateProfileUI(uiData);
        localStorage.setItem('userProfile', JSON.stringify(uiData));
        
        // Update main user data for dashboard greeting
        const userData = JSON.parse(localStorage.getItem('userData')) || {};
        userData.name = newData.fullName;
        localStorage.setItem('userData', JSON.stringify(userData));

        closeModal();
    });
}

function updateProfileUI(data) {
    if(data.fullName) {
        document.getElementById('fullName').textContent = data.fullName;
        const displayName = document.getElementById('displayName');
        if(displayName) displayName.textContent = data.fullName;
    }
    if(data.email) {
        document.getElementById('infoEmail').textContent = data.email;
        const displayEmail = document.getElementById('displayEmail');
        if(displayEmail) displayEmail.textContent = data.email;
    }
    if(data.phone) document.getElementById('infoPhone').textContent = data.phone;
    if(data.dob) document.getElementById('infoDOB').textContent = data.dob;
    if(data.gender) document.getElementById('infoGender').textContent = data.gender;
}

// =========================
// GRADES PAGE FUNCTIONALITY
// =========================
function initializeGradesTable() {
    const rows = document.querySelectorAll('.grades-table .table-row');
    
    rows.forEach(row => {
        row.addEventListener('click', () => {
            // Close other rows (accordion style)
            rows.forEach(r => {
                if (r !== row) r.classList.remove('active');
            });
            row.classList.toggle('active');
        });
    });
}

function initializeGradesFilter() {
    const controls = document.querySelector('.grades-controls');
    if (!controls) return;

    const table = document.querySelector('.grades-table');
    if (!table) return;

    const buttons = controls.querySelectorAll('button[data-term]');

    buttons.forEach(button => {
        button.addEventListener('click', () => {
            // Update active button
            buttons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            const term = button.dataset.term;

            // Remove all term-specific classes from the table
            table.classList.remove('show-prelim', 'show-midterm', 'show-final');

            // Add the specific class if not 'all'
            if (term !== 'all') {
                table.classList.add(`show-${term}`);
            }
        });
    });
}

// =========================
// INITIALIZE EVERYTHING ON DOM
// =========================
document.addEventListener("DOMContentLoaded", () => {
    initializeTheme();
    initializeLogin();
    initializeSignup();
    initializeRoleToggle();
    initializePasswordToggles();
    initializeDashboard();
    initializeHelp();
    initializeSubjects();
    initializeProfile();
    initializeGradesTable();
    initializeGradesFilter();

    // THEME BUTTONS FOR MULTIPLE PAGES
    const darkModeBtn = document.getElementById("darkModeBtn");
    const lightModeBtn = document.getElementById("lightModeBtn");
    const darkThemeBtn = document.getElementById("darkThemeBtn");
    const lightThemeBtn = document.getElementById("lightThemeBtn");

    if (darkModeBtn) darkModeBtn.addEventListener("click", () => applyTheme("dark"));
    if (lightModeBtn) lightModeBtn.addEventListener("click", () => applyTheme("light"));
    if (darkThemeBtn) darkThemeBtn.addEventListener("click", () => applyTheme("dark"));
    if (lightThemeBtn) lightThemeBtn.addEventListener("click", () => applyTheme("light"));

    document.getElementById("logoutBtn")?.addEventListener("click", logout);
});

// =========================
// EXPORT LOGOUT & THEME
// =========================
export { logout, applyTheme };
