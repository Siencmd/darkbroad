// =========================
// IMPORT FIREBASE AUTH
// =========================
import { auth } from './firebase.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const db = getFirestore();

// =========================
// THEME TOGGLE
// =========================
function initializeTheme() {
    const theme = localStorage.getItem("theme") || "dark";
    applyTheme(theme);
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

            // Store logged-in user in localStorage
            localStorage.setItem("isLoggedIn", "true");
            localStorage.setItem("userData", JSON.stringify({ id: user.uid, name: user.displayName || email }));

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

        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            await updateProfile(user, { displayName: fullName });

            await setDoc(doc(db, "students", user.uid), {
                fullName,
                email,
                phone,
                course,
                role: "student",
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

    // Get subjects from localStorage or use dummy data
    let subjects = JSON.parse(localStorage.getItem('subjects')) || [
        {
            name: "Mathematics",
            teacher: "Mr. Anderson",
            time: "08:00 AM - 09:30 AM",
            description: "Advanced Calculus and Algebra",
            tasks: [
                { title: "Complete Chapter 5 Exercises", dueDate: "2023-10-15", priority: "high", status: "pending", description: "Solve all exercises in Chapter 5", file: null }
            ],
            assignments: [
                { title: "Research Paper", dueDate: "2023-10-20", points: 100, status: "pending", instructions: "Write a 5-page research paper on Calculus", file: null }
            ],
            lessons: []
        },
        {
            name: "Physics",
            teacher: "Ms. Curie",
            time: "10:00 AM - 11:30 AM",
            description: "Fundamentals of Physics",
            tasks: [],
            assignments: [],
            lessons: []
        },
        {
            name: "Computer Science",
            teacher: "Mr. Turing",
            time: "01:00 PM - 02:30 PM",
            description: "Algorithms and Data Structures",
            tasks: [],
            assignments: [],
            lessons: []
        }
    ];

    // Load subjects from Firestore if user is logged in
    const userData = JSON.parse(localStorage.getItem("userData"));
    if (userData && userData.id) {
        loadSubjectsFromFirestore(userData.id);
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

        detailsContainer.innerHTML = `
            <div class="detail-header">
                <h2>${sub.name}</h2>
                <div class="detail-meta">
                    <span><i class="fas fa-chalkboard-teacher"></i> ${sub.teacher}</span>
                    <span><i class="fas fa-clock"></i> ${sub.time}</span>
                </div>
                <p class="detail-description">${sub.description || "No description available."}</p>
            <div class="detail-actions">
                <button class="btn-edit-subject" data-index="${index}">
                    <i class="fas fa-edit"></i> Edit
                </button>
                <button class="btn-sync-cloud" data-index="${index}">
                    <i class="fas fa-cloud-upload-alt"></i> Sync to Cloud
                </button>
            </div>
            </div>

            <div class="subject-tabs">
                <button class="tab-btn active" data-tab="tasks">Tasks</button>
                <button class="tab-btn" data-tab="assignments">Assignments</button>
                <button class="tab-btn" data-tab="lessons">Lessons</button>
            </div>

            <div class="tab-content active" id="tasks-tab">
                <div class="items-container">
                    <div class="items-header">
                        <h3><i class="fas fa-tasks"></i> Tasks</h3>
                        <button class="btn-add-item" data-type="task" data-subject-index="${index}">
                            <i class="fas fa-plus"></i> Add Task
                        </button>
                    </div>
                    <div class="items-list">
                        ${sub.tasks.map((task, i) => `
                            <div class="item-card">
                                <div class="item-info">
                                    <h4>${task.title}</h4>
                                    <p>Due: ${task.dueDate} | Priority: ${task.priority} | Status: ${task.status}</p>
                                    <p>${task.description}</p>
                                    ${task.file ? `<p><i class="fas fa-paperclip"></i> ${task.file}</p>` : ''}
                                </div>
                                <div class="item-actions">
                                    <button class="btn-edit-item" data-type="task" data-item-index="${i}" data-subject-index="${index}">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn-delete-item" data-type="task" data-item-index="${i}" data-subject-index="${index}">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <div class="tab-content" id="assignments-tab">
                <div class="items-container">
                    <div class="items-header">
                        <h3><i class="fas fa-clipboard-list"></i> Assignments</h3>
                        <button class="btn-add-item" data-type="assignment" data-subject-index="${index}">
                            <i class="fas fa-plus"></i> Add Assignment
                        </button>
                    </div>
                    <div class="items-list">
                        ${sub.assignments.map((assignment, i) => `
                            <div class="item-card">
                                <div class="item-info">
                                    <h4>${assignment.title}</h4>
                                    <p>Due: ${assignment.dueDate} | Points: ${assignment.points} | Status: ${assignment.status}</p>
                                    <p>${assignment.instructions}</p>
                                    ${assignment.file ? `<p><i class="fas fa-paperclip"></i> ${assignment.file}</p>` : ''}
                                </div>
                                <div class="item-actions">
                                    <button class="btn-edit-item" data-type="assignment" data-item-index="${i}" data-subject-index="${index}">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn-delete-item" data-type="assignment" data-item-index="${i}" data-subject-index="${index}">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <div class="tab-content" id="lessons-tab">
                <div class="items-container">
                    <div class="items-header">
                        <h3><i class="fas fa-book-open"></i> Lessons</h3>
                        <button class="btn-add-item" data-type="lesson" data-subject-index="${index}">
                            <i class="fas fa-plus"></i> Add Lesson
                        </button>
                    </div>
                    <div class="items-list">
                        ${sub.lessons.map((lesson, i) => `
                            <div class="item-card">
                                <div class="lesson-info">
                                    <h4>${lesson.title}</h4>
                                    <p><i class="fas fa-clock"></i> ${lesson.duration} • ${lesson.status}</p>
                                    <p>${lesson.content}</p>
                                    ${lesson.file ? `<p><i class="fas fa-paperclip"></i> ${lesson.file}</p>` : ''}
                                </div>
                                <div class="item-actions">
                                    <button class="btn-edit-item" data-type="lesson" data-item-index="${i}" data-subject-index="${index}">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn-delete-item" data-type="lesson" data-item-index="${i}" data-subject-index="${index}">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('')}
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

        // Add click listener for Sync to Cloud button
        document.querySelectorAll('.btn-sync-cloud').forEach(btn => {
            btn.addEventListener('click', () => {
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
    addForm?.addEventListener('submit', e => {
        e.preventDefault();

        const subject = {
            name: document.getElementById('newSubjectName').value.trim(),
            teacher: document.getElementById('newTeacherName').value.trim(),
            time: document.getElementById('newSubjectTime').value.trim(),
            description: document.getElementById('newSubjectDescription').value.trim(),
            lessons: []
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
    addTaskForm?.addEventListener('submit', e => {
        e.preventDefault();

        const subjectIndex = parseInt(document.getElementById('taskSubjectIndex').value);
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const fileInput = document.getElementById('newTaskFile');
        const fileName = fileInput.files[0] ? fileInput.files[0].name : null;

        const task = {
            title: document.getElementById('newTaskTitle').value.trim(),
            dueDate: document.getElementById('newTaskDueDate').value,
            priority: document.getElementById('newTaskPriority').value,
            status: 'pending',
            description: document.getElementById('newTaskDescription').value.trim(),
            file: fileName
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
    editTaskForm?.addEventListener('submit', e => {
        e.preventDefault();

        const itemIndex = parseInt(document.getElementById('editTaskIndex').value);
        const subjectIndex = parseInt(document.getElementById('editTaskSubjectIndex').value);
        const sub = subjects[subjectIndex];
        if (!sub || !sub.tasks[itemIndex]) return;

        const fileInput = document.getElementById('editTaskFile');
        const fileName = fileInput.files[0] ? fileInput.files[0].name : sub.tasks[itemIndex].file;

        sub.tasks[itemIndex] = {
            title: document.getElementById('editTaskTitle').value.trim(),
            dueDate: document.getElementById('editTaskDueDate').value,
            priority: document.getElementById('editTaskPriority').value,
            status: document.getElementById('editTaskStatus').value,
            description: document.getElementById('editTaskDescription').value.trim(),
            file: fileName
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
    addAssignmentForm?.addEventListener('submit', e => {
        e.preventDefault();

        const subjectIndex = parseInt(document.getElementById('assignmentSubjectIndex').value);
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const fileInput = document.getElementById('newAssignmentFile');
        const fileName = fileInput.files[0] ? fileInput.files[0].name : null;

        const assignment = {
            title: document.getElementById('newAssignmentTitle').value.trim(),
            dueDate: document.getElementById('newAssignmentDueDate').value,
            points: parseInt(document.getElementById('newAssignmentPoints').value),
            status: document.getElementById('newAssignmentStatus').value,
            instructions: document.getElementById('newAssignmentInstructions').value.trim(),
            file: fileName
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
    editAssignmentForm?.addEventListener('submit', e => {
        e.preventDefault();

        const itemIndex = parseInt(document.getElementById('editAssignmentIndex').value);
        const subjectIndex = parseInt(document.getElementById('editAssignmentSubjectIndex').value);
        const sub = subjects[subjectIndex];
        if (!sub || !sub.assignments[itemIndex]) return;

        const fileInput = document.getElementById('editAssignmentFile');
        const fileName = fileInput.files[0] ? fileInput.files[0].name : sub.assignments[itemIndex].file;

        sub.assignments[itemIndex] = {
            title: document.getElementById('editAssignmentTitle').value.trim(),
            dueDate: document.getElementById('editAssignmentDueDate').value,
            points: parseInt(document.getElementById('editAssignmentPoints').value),
            status: document.getElementById('editAssignmentStatus').value,
            instructions: document.getElementById('editAssignmentInstructions').value.trim(),
            file: fileName
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
    addLessonForm?.addEventListener('submit', e => {
        e.preventDefault();

        const subjectIndex = parseInt(document.getElementById('lessonSubjectIndex').value);
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const fileInput = document.getElementById('newLessonFile');
        const fileName = fileInput.files[0] ? fileInput.files[0].name : null;

        const lesson = {
            title: document.getElementById('newLessonTitle').value.trim(),
            duration: document.getElementById('newLessonDuration').value.trim(),
            status: document.getElementById('newLessonStatus').value,
            content: document.getElementById('newLessonContent').value.trim(),
            file: fileName
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
    editLessonForm?.addEventListener('submit', e => {
        e.preventDefault();

        const itemIndex = parseInt(document.getElementById('editLessonIndex').value);
        const subjectIndex = parseInt(document.getElementById('editLessonSubjectIndex').value);
        const sub = subjects[subjectIndex];
        if (!sub || !sub.lessons[itemIndex]) return;

        const fileInput = document.getElementById('editLessonFile');
        const fileName = fileInput.files[0] ? fileInput.files[0].name : sub.lessons[itemIndex].file;

        sub.lessons[itemIndex] = {
            title: document.getElementById('editLessonTitle').value.trim(),
            duration: document.getElementById('editLessonDuration').value.trim(),
            status: document.getElementById('editLessonStatus').value,
            content: document.getElementById('editLessonContent').value.trim(),
            file: fileName
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
        const modalId = `add${type.charAt(0).toUpperCase() + type.slice(1)}Modal`;
        const modal = document.getElementById(modalId);
        if (!modal) return;

        document.getElementById(`${type}SubjectIndex`).value = subjectIndex;
        modal.style.display = 'block';
    }

    // -------------------------
    // OPEN EDIT ITEM MODAL
    // -------------------------
    function openEditItemModal(subjectIndex, type, itemIndex) {
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const item = sub[`${type}s`][itemIndex];
        if (!item) return;

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
    function saveSubjects() {
        localStorage.setItem('subjects', JSON.stringify(subjects));
    }

    // -------------------------
    // LOAD SUBJECTS FROM FIRESTORE
    // -------------------------
    async function loadSubjectsFromFirestore(userId) {
        try {
            const docRef = doc(db, "subjects", userId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                subjects = docSnap.data().subjects || subjects;
                saveSubjects(); // Sync to localStorage
                renderSubjects();
            }
        } catch (error) {
            console.error("Error loading subjects from Firestore:", error);
        }
    }

    // -------------------------
    // SAVE SUBJECTS TO FIRESTORE
    // -------------------------
    async function saveSubjectsToFirestore() {
        const userData = JSON.parse(localStorage.getItem("userData"));
        if (!userData || !userData.id) {
            alert("Please log in to sync to cloud.");
            return;
        }

        try {
            await setDoc(doc(db, "subjects", userData.id), {
                subjects: subjects,
                lastUpdated: serverTimestamp()
            });
            alert("Subjects synced to cloud successfully!");
        } catch (error) {
            console.error("Error saving subjects to Firestore:", error);
            alert("Failed to sync to cloud. Please try again.");
        }
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
    initializePasswordToggles();
    initializeDashboard();
    initializeHelp();
    initializeSubjects();
    initializeProfile();
    initializeGradesTable();
    initializeGradesFilter();

    // THEME BUTTONS FOR MULTIPLE PAGES
    document.getElementById("darkModeBtn")?.addEventListener("click", () => applyTheme("dark"));
    document.getElementById("lightModeBtn")?.addEventListener("click", () => applyTheme("light"));
    document.getElementById("darkThemeBtn")?.addEventListener("click", () => applyTheme("dark"));
    document.getElementById("lightThemeBtn")?.addEventListener("click", () => applyTheme("light"));
    document.getElementById("logoutBtn")?.addEventListener("click", logout);
});

// =========================
// EXPORT LOGOUT & THEME
// =========================
export { logout, applyTheme };
