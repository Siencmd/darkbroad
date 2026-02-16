// =========================
// IMPORT FIREBASE AUTH & SUPABASE
// =========================
import { auth, db } from './firebase.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, setDoc, getDoc, getDocs, collection, onSnapshot, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { supabase } from './supabase.js';
import { setupRealtimeSubjects, stopTaskListeners } from './realtime.js';

// Maximum subjects limit to prevent Firestore quota issues
const MAX_SUBJECTS_LIMIT = 10;

let subjectsRealtimeUnsubscribe = null;
let disableSubjectsRealtime = false;
let isSavingSubjects = false; // Flag to prevent realtime loop when saving
let syncTimer = null;
let lastSyncedSubjectsHash = null;
let assignmentSubmissionListeners = {};
let assignmentCountsSubjectKey = null;
const DEBUG_MODE = false;

function debugLog(...args) {
    if (DEBUG_MODE) console.log(...args);
}

// db is now imported from firebase.js

function normalizeSubject(subject, index = 0) {
    const normalizeTask = (task, taskIndex = 0) => ({
        ...task,
        id: task?.id || `legacy-task-${index}-${taskIndex}`,
        status: ['pending', 'in-progress', 'completed', 'submitted'].includes(task?.status) ? task.status : 'pending',
        file: task?.file || task?.fileName || null,
        fileUrl: task?.fileUrl || task?.url || null,
        submissions: Array.isArray(task?.submissions) ? task.submissions : []
    });

    const normalizeAssignment = (assignment, assignmentIndex = 0) => ({
        ...assignment,
        id: assignment?.id || `legacy-assignment-${index}-${assignmentIndex}`,
        submissions: Array.isArray(assignment?.submissions) ? assignment.submissions : []
    });

    const normalizeLesson = (lesson, lessonIndex = 0) => ({
        ...lesson,
        id: lesson?.id || `legacy-lesson-${index}-${lessonIndex}`
    });

    const normalizeQuiz = (quiz, quizIndex = 0) => ({
        ...quiz,
        id: quiz?.id || `legacy-quiz-${index}-${quizIndex}`,
        title: quiz?.title || "Untitled Quiz",
        dueDate: quiz?.dueDate || "",
        points: quiz?.points || 0,
        status: quiz?.status || "available",
        instructions: quiz?.instructions || "",
        quizLink: quiz?.quizLink || "",
        submissions: Array.isArray(quiz?.submissions) ? quiz.submissions : []
    });

    return {
        id: subject?.id || `legacy-subject-${index}`,
        name: subject?.name || "Untitled Subject",
        teacher: subject?.teacher || "",
        time: subject?.time || "",
        description: subject?.description || "",
        tasks: Array.isArray(subject?.tasks) ? subject.tasks.map((task, taskIndex) => normalizeTask(task, taskIndex)) : [],
        assignments: Array.isArray(subject?.assignments) ? subject.assignments.map((assignment, assignmentIndex) => normalizeAssignment(assignment, assignmentIndex)) : [],
        lessons: Array.isArray(subject?.lessons) ? subject.lessons.map((lesson, lessonIndex) => normalizeLesson(lesson, lessonIndex)) : [],
        quizzes: Array.isArray(subject?.quizzes) ? subject.quizzes.map((quiz, quizIndex) => normalizeQuiz(quiz, quizIndex)) : []
    };
}

function normalizeSubjects(list) {
    if (!Array.isArray(list)) return [];
    return list.map((subject, index) => normalizeSubject(subject, index));
}

function isInstructorRoleValue(role) {
    const normalizedRole = (role || '').toLowerCase();
    return normalizedRole === 'instructor' || normalizedRole === 'teacher' || normalizedRole === 'admin';
}

function canSyncCourseData(userData) {
    return !!(userData && userData.course && isInstructorRoleValue(userData.role));
}

function normalizeCourseId(courseValue) {
    return typeof courseValue === 'string' ? courseValue.trim() : '';
}

function normalizeRole(roleValue) {
    return typeof roleValue === 'string' ? roleValue.trim().toLowerCase() : '';
}

// Helper function to combine day and time for schedule
function combineDayAndTime(day, time) {
    if (!day && !time) return '';
    if (!day) return time;
    if (!time) return day;
    // Check if time already contains a day
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const timeLower = time.toLowerCase();
    for (const d of days) {
        if (timeLower.includes(d.toLowerCase())) {
            return time; // Time already has day, return as-is
        }
    }
    return `${day} ${time}`;
}

// Helper function to extract day from time string for editing
function extractDayFromTime(time) {
    if (!time) return '';
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const timeLower = time.toLowerCase();
    for (const day of days) {
        if (timeLower.includes(day.toLowerCase())) {
            return day;
        }
    }
    return '';
}

// Helper function to extract just the time (without day) from time string
function extractTimeFromTime(time) {
    if (!time) return '';
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    let result = time;
    for (const day of days) {
        const regex = new RegExp(day + '\\s+', 'i');
        result = result.replace(regex, '');
    }
    return result.trim();
}

async function getUserProfileByUid(uid) {
    if (!uid) return { source: "none", data: null };

    const usersSnap = await getDoc(doc(db, "users", uid));
    if (usersSnap.exists()) {
        return { source: "users", data: usersSnap.data() };
    }

    const instructorsSnap = await getDoc(doc(db, "instructors", uid));
    if (instructorsSnap.exists()) {
        return { source: "instructors", data: instructorsSnap.data() };
    }

    const studentsSnap = await getDoc(doc(db, "students", uid));
    if (studentsSnap.exists()) {
        return { source: "students", data: studentsSnap.data() };
    }

    return { source: "none", data: null };
}

function buildStoragePath({ courseId = "", subjectId = "", itemType = "", itemId = "", userId = "", fileName = "" }) {
    const safeCourse = normalizeCourseId(courseId) || "unknown-course";
    const safeSubject = subjectId || "unknown-subject";
    const safeType = itemType || "misc";
    const safeItem = itemId || "unknown-item";
    const safeName = fileName || "file";
    const parts = ["courses", safeCourse, "subjects", safeSubject, safeType, safeItem];
    if (userId) parts.push("submissions", userId);
    parts.push(safeName);
    return parts.join("/");
}

function buildStoragePrefix({ courseId = "", subjectId = "", itemType = "", itemId = "", userId = "" }) {
    const safeCourse = normalizeCourseId(courseId) || "unknown-course";
    const safeSubject = subjectId || "unknown-subject";
    const safeType = itemType || "misc";
    const safeItem = itemId || "unknown-item";
    const parts = ["courses", safeCourse, "subjects", safeSubject, safeType, safeItem];
    if (userId) parts.push("submissions", userId);
    return `${parts.join("/")}/`;
}

async function waitForAuthReady(timeoutMs = 5000) {
    if (auth.currentUser) return auth.currentUser;

    return new Promise((resolve) => {
        let resolved = false;
        const timer = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            unsubscribe();
            resolve(auth.currentUser || null);
        }, timeoutMs);

        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            unsubscribe();
            resolve(user || null);
        });
    });
}

async function getServerUserProfile() {
    const uid = auth.currentUser?.uid || JSON.parse(localStorage.getItem("userData") || "{}")?.id;
    if (!uid) return null;
    const profile = await getUserProfileByUid(uid);
    return profile.data ? { source: profile.source, uid, ...profile.data } : { source: "none", uid };
}

const storedSubjects = normalizeSubjects(JSON.parse(localStorage.getItem('subjects')));
let subjects = storedSubjects;

// Function to setup task listeners for all subjects
function setupTaskListeners() {
    // Tasks are currently stored in each subject document array on /subjects/{courseId}.
    // Listening to /subjects/{subjectId}/tasks causes permission errors for this schema.
    // Keep this as a no-op until the app fully migrates to per-subject task subcollections.
    return;
}

function stopAssignmentSubmissionCountListeners() {
    Object.values(assignmentSubmissionListeners).forEach((unsubscribe) => {
        try {
            unsubscribe();
        } catch (error) {
            console.warn("Failed to unsubscribe assignment submission listener:", error.message);
        }
    });
    assignmentSubmissionListeners = {};
    assignmentCountsSubjectKey = null;
}

function setupAssignmentSubmissionCountListeners(subjectIndex, activeCourseId = "") {
    const userData = JSON.parse(localStorage.getItem("userData") || "{}");
    const courseId = normalizeCourseId(activeCourseId) || normalizeCourseId(userData?.course);
    const sub = subjects[subjectIndex];
    if (!courseId || !sub) return;

    const subjectKey = `${courseId}:${sub.id || subjectIndex}:${isInstructorRoleValue(userData?.role) ? "instructor" : "student"}:${userData?.id || ""}`;
    if (assignmentCountsSubjectKey === subjectKey) return;

    stopAssignmentSubmissionCountListeners();
    assignmentCountsSubjectKey = subjectKey;

    const watchSubmissions = (items, collectionName, keyName) => {
        if (!Array.isArray(items)) return;

        items.forEach((item) => {
            if (!item?.id) return;
            const submissionsRef = collection(db, "subjects", courseId, collectionName, item.id, "submissions");

            // Hydrate once so counts don't stay stale while waiting for the first realtime callback.
            getDocs(submissionsRef).then((snapshot) => {
                const initialSubmissions = [];
                snapshot.forEach((submissionDoc) => {
                    initialSubmissions.push({ id: submissionDoc.id, ...submissionDoc.data() });
                });
                item.submissions = initialSubmissions;

                const countEl = document.querySelector(`.submission-count[data-${keyName}-id="${item.id}"]`);
                if (countEl) {
                    if (keyName === "quiz") {
                        countEl.innerHTML = `<i class="fas fa-users"></i> ${initialSubmissions.length} submission${initialSubmissions.length !== 1 ? "s" : ""}`;
                    } else {
                        countEl.textContent = String(initialSubmissions.length);
                    }
                }
            }).catch((error) => {
                console.warn(`Initial submissions load failed for ${collectionName} ${item.id}:`, error.message);
            });

            const listenerKey = `${collectionName}:${item.id}`;
            assignmentSubmissionListeners[listenerKey] = onSnapshot(submissionsRef, (snapshot) => {
                const hadOwnSubmission = Array.isArray(item.submissions)
                    ? item.submissions.some((submission) => (submission.studentId || submission.id) === userData?.id)
                    : false;

                const liveSubmissions = [];
                snapshot.forEach((submissionDoc) => {
                    liveSubmissions.push({ id: submissionDoc.id, ...submissionDoc.data() });
                });
                item.submissions = liveSubmissions;

                if (keyName === "task") {
                    const hasOwnSubmission = liveSubmissions.some((submission) => (submission.studentId || submission.id) === userData?.id);
                    const submittedIndicator = document.querySelector(`.task-submitted-indicator[data-task-submitted-id="${item.id}"]`);
                    if (submittedIndicator) {
                        submittedIndicator.style.display = hasOwnSubmission ? "block" : "none";
                    }

                    if (hasOwnSubmission && item.status !== "submitted") {
                        item.status = "submitted";
                    }

                    if (!isInstructorRoleValue(userData?.role) && hadOwnSubmission !== hasOwnSubmission) {
                        const statusLine = document.querySelector(`.task-status-line[data-task-status-id="${item.id}"]`);
                        if (statusLine) {
                            statusLine.textContent = `Due: ${item.dueDate} | Priority: ${item.priority} | Status: ${item.status}`;
                        }
                    }
                }

                const countEl = document.querySelector(`.submission-count[data-${keyName}-id="${item.id}"]`);
                if (countEl) {
                    if (keyName === "quiz") {
                        countEl.innerHTML = `<i class="fas fa-users"></i> ${liveSubmissions.length} submission${liveSubmissions.length !== 1 ? "s" : ""}`;
                    } else {
                        countEl.textContent = String(liveSubmissions.length);
                    }
                }
            }, (error) => {
                console.warn(`Realtime submission count failed for ${collectionName} ${item.id}:`, error.message);
            });
        });
    };

    watchSubmissions(sub.assignments, "assignments", "assignment");
    watchSubmissions(sub.tasks, "tasks", "task");
    watchSubmissions(sub.quizzes, "quizzes", "quiz");
}

async function hydrateSubmissionCountsForSubject(subjectIndex, activeCourseId = "") {
    const userData = JSON.parse(localStorage.getItem("userData") || "{}");
    const courseId = normalizeCourseId(activeCourseId) || normalizeCourseId(userData?.course);
    const sub = subjects[subjectIndex];
    if (!courseId || !sub) return;

    const hydrateItems = async (items, collectionName, keyName) => {
        if (!Array.isArray(items)) return;

        for (const item of items) {
            if (!item?.id) continue;
            try {
                const submissionsRef = collection(db, "subjects", courseId, collectionName, item.id, "submissions");
                const submissionsSnap = await getDocs(submissionsRef);
                const submissions = [];
                submissionsSnap.forEach((submissionDoc) => {
                    submissions.push({ id: submissionDoc.id, ...submissionDoc.data() });
                });
                item.submissions = submissions;

                const countEl = document.querySelector(`.submission-count[data-${keyName}-id="${item.id}"]`);
                if (countEl) {
                    if (keyName === "quiz") {
                        countEl.innerHTML = `<i class="fas fa-users"></i> ${submissions.length} submission${submissions.length !== 1 ? "s" : ""}`;
                    } else {
                        countEl.textContent = String(submissions.length);
                    }
                }

                if (keyName === "task") {
                    const hasOwnSubmission = submissions.some((submission) => (submission.studentId || submission.id) === userData?.id);
                    const submittedIndicator = document.querySelector(`.task-submitted-indicator[data-task-submitted-id="${item.id}"]`);
                    if (submittedIndicator) {
                        submittedIndicator.style.display = hasOwnSubmission ? "block" : "none";
                    }
                    if (hasOwnSubmission && item.status !== "submitted") {
                        item.status = "submitted";
                        const statusLine = document.querySelector(`.task-status-line[data-task-status-id="${item.id}"]`);
                        if (statusLine) {
                            statusLine.textContent = `Due: ${item.dueDate} | Priority: ${item.priority} | Status: ${item.status}`;
                        }
                    }
                }
            } catch (error) {
                console.warn(`Failed to hydrate ${collectionName} submissions for ${item.id}:`, error.message);
            }
        }
    };

    await Promise.all([
        hydrateItems(sub.assignments, "assignments", "assignment"),
        hydrateItems(sub.tasks, "tasks", "task"),
        hydrateItems(sub.quizzes, "quizzes", "quiz")
    ]);
}



// Upload file to Supabase with enhanced error handling and logging
async function uploadFileToSupabase(file, path) {
    try {
        debugLog('Starting upload to Supabase:', path + file.name);
        const { data, error } = await supabase.storage.from('files').upload(path + file.name, file, {
            upsert: true
        });
        if (error) {
            console.error('Supabase upload error:', error);
            throw new Error(`Upload failed: ${error.message}`);
        }
        debugLog('Upload successful, getting public URL');
        const { data: urlData } = supabase.storage.from('files').getPublicUrl(path + file.name);
        if (!urlData || !urlData.publicUrl) {
            throw new Error('Failed to get public URL');
        }
        debugLog('Public URL obtained:', urlData.publicUrl);
        return urlData.publicUrl;
    } catch (error) {
        console.error('Upload error:', error);
        alert(`File upload failed: ${error.message}`);
        return null;
    }
}

// =========================
// THEME TOGGLE
// =========================
function initializeTheme() {
    const theme = localStorage.getItem("theme") || "dark";
    applyTheme(theme);

    // Settings page toggle switch
    const themeToggle = document.getElementById("themeToggle");
    if (themeToggle) {
        themeToggle.checked = theme === "dark";
        themeToggle.addEventListener("change", () => {
            applyTheme(themeToggle.checked ? "dark" : "light");
        });
    }

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

    // Update toggle switch if present
    const themeToggle = document.getElementById("themeToggle");
    if (themeToggle) {
        themeToggle.checked = theme === "dark";
    }

    // Legacy button support (for other pages)
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
            const {user} = userCredential;

            let userRole = 'student';
            let userCourse = '';
            const profile = await getUserProfileByUid(user.uid);
            if (profile.data) {
                const { role = 'student', course = '' } = profile.data;
                userRole = role;
                userCourse = course;
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
        const role = document.querySelector('input[name="role"]:checked').value.toLowerCase();
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

if (role === "instructor" && accessCode !== "INSTRUCTOR2026") {
              setMessage("signupMessage", "Invalid access code for Instructor");
              return;
        }

        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const { user } = userCredential;

            await updateProfile(user, { displayName: fullName });

            const profilePayload = {
                fullName,
                email,
                phone,
                course,
                role,
                createdAt: serverTimestamp()
            };

            await setDoc(doc(db, "users", user.uid), profilePayload);
            if (role === "instructor") {
                await setDoc(doc(db, "instructors", user.uid), profilePayload, { merge: true });
            }

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
    const togglePassword = function(inputId, iconId) {
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
    try {
        const userDataStr = localStorage.getItem("userData");
        if (!userDataStr) return;
        
        const userData = JSON.parse(userDataStr);
        if (!userData || !userData.name) return;

        const userNameEl = document.getElementById("headerUserName");
        const dashboardNameEl = document.getElementById("dashboardUserName");
        const greetingEl = document.getElementById("greetingMessage") || document.querySelector(".greetingMessage");

        if (userNameEl) userNameEl.textContent = userData.name;
        if (dashboardNameEl) dashboardNameEl.textContent = userData.name.split(" ")[0];

        if (greetingEl) {
            const hour = new Date().getHours();
            greetingEl.textContent = hour < 12 ? "Good morning 🌅" :
                                     hour < 17 ? "Good afternoon ☀️" :
                                                 "Good evening 🌙";
        }
    } catch (e) {
        console.error("Error initializing dashboard:", e);
    }
}

function initializeHeaderProfileMenu() {
    const nav = document.querySelector('.main-nav');
    if (!nav) return;

    const navList = nav.querySelector('.nav-list');
    if (navList) {
        const removableLinks = Array.from(navList.querySelectorAll('a.nav-item'));
        removableLinks.forEach((link) => {
            const href = (link.getAttribute('href') || '').toLowerCase();
            const text = (link.textContent || '').trim().toLowerCase();
            const isProfileNav = href.endsWith('profile.html') || text === 'profile';
            const isSettingsNav = href.endsWith('settings.html') || text === 'settings';
            const isHelpNav = href.endsWith('help.html') || text === 'help';
            const isLogoutNav = link.id === 'logoutBtn' || text === 'logout';

            if (isProfileNav || isSettingsNav || isHelpNav || isLogoutNav) {
                link.closest('li')?.remove();
            }
        });
    }

    const userMenu = nav.querySelector('.user-menu-right');
    if (!userMenu || userMenu.dataset.dropdownInitialized === 'true') return;
    userMenu.dataset.dropdownInitialized = 'true';

    const userName = userMenu.querySelector('#headerUserName');
    if (userName) userName.style.display = 'none';

    userMenu.style.position = 'relative';
    userMenu.setAttribute('role', 'button');
    userMenu.setAttribute('tabindex', '0');
    userMenu.setAttribute('aria-haspopup', 'true');
    userMenu.setAttribute('aria-expanded', 'false');

    const existingMenu = document.getElementById('headerProfileDropdown');
    if (existingMenu) existingMenu.remove();

    const dropdown = document.createElement('div');
    dropdown.id = 'headerProfileDropdown';
    dropdown.style.position = 'absolute';
    dropdown.style.top = 'calc(100% + 10px)';
    dropdown.style.right = '0';
    dropdown.style.minWidth = '180px';
    dropdown.style.background = 'var(--card-bg)';
    dropdown.style.border = '1px solid var(--glass-border)';
    dropdown.style.borderRadius = '10px';
    dropdown.style.padding = '8px';
    dropdown.style.boxShadow = 'var(--glass-shadow)';
    dropdown.style.zIndex = '10000';
    dropdown.style.display = 'none';
    
    // Get user name for dropdown header
    let userDisplayName = 'User';
    try {
        const userData = JSON.parse(localStorage.getItem('userData'));
        if (userData && userData.name) {
            userDisplayName = userData.name;
        }
    } catch (e) {}
    
    dropdown.innerHTML = `
        <div class="profile-dropdown-header" style="padding: 10px 12px; border-bottom: 1px solid var(--glass-border); margin-bottom: 8px;">
            <span style="font-weight: 600; color: var(--text-primary);">${userDisplayName}</span>
        </div>
        <a href="Profile.html" class="profile-dropdown-item" data-action="profile">Profile</a>
        <a href="Settings.html" class="profile-dropdown-item" data-action="settings">Settings</a>
        <a href="Help.html" class="profile-dropdown-item" data-action="help">Help</a>
        <a href="#" class="profile-dropdown-item" data-action="logout">Logout</a>
    `;
    userMenu.appendChild(dropdown);

    const dropdownLinks = dropdown.querySelectorAll('.profile-dropdown-item');
    dropdownLinks.forEach((link) => {
        link.style.display = 'block';
        link.style.padding = '10px 12px';
        link.style.borderRadius = '8px';
        link.style.color = 'var(--text-primary)';
        link.style.textDecoration = 'none';
        link.style.fontSize = '0.9rem';
        link.style.fontWeight = '500';
        link.addEventListener('mouseenter', () => {
            link.style.background = 'rgba(255, 255, 255, 0.1)';
            link.style.color = 'var(--accent)';
        });
        link.addEventListener('mouseleave', () => {
            link.style.background = 'transparent';
            link.style.color = 'var(--text-primary)';
        });
    });

    const setOpen = (open) => {
        dropdown.style.display = open ? 'block' : 'none';
        userMenu.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    const toggleMenu = () => {
        const isOpen = dropdown.style.display === 'block';
        setOpen(!isOpen);
    };

    // Click event for desktop and mobile
    userMenu.addEventListener('click', (event) => {
        if (event.target.closest('.profile-dropdown-item')) return;
        toggleMenu();
    });

    // Close dropdown when clicking outside (for both click and touch)
    document.addEventListener('click', (event) => {
        if (!userMenu.contains(event.target)) setOpen(false);
    });

    document.addEventListener('touchstart', (event) => {
        if (!userMenu.contains(event.target)) setOpen(false);
    }, { passive: true });

    dropdown.addEventListener('click', async (event) => {
        console.log('[ProfileMenu] Dropdown item clicked');
        const actionLink = event.target.closest('.profile-dropdown-item');
        if (!actionLink) {
            console.log('[ProfileMenu] No action link found, target:', event.target);
            return;
        }

        const { action } = actionLink.dataset;
        console.log('[ProfileMenu] Action:', action);
        if (action === 'logout') {
            event.preventDefault();
            await logout();
        } else {
            event.preventDefault();
            setOpen(false);
            // Navigate to the href
            const href = actionLink.getAttribute('href');
            console.log('[ProfileMenu] Navigating to:', href);
            if (href && href !== '#') {
                window.location.href = href;
            }
        }
    });

    // Touch support for dropdown items on mobile
    dropdown.addEventListener('touchend', async (event) => {
        const actionLink = event.target.closest('.profile-dropdown-item');
        if (!actionLink) return;

        const { action } = actionLink.dataset;
        if (action === 'logout') {
            event.preventDefault();
            await logout();
        } else {
            setOpen(false);
        }
    });
}

// =========================
// LOGOUT
// =========================
async function logout(e) {
    if (e) e.preventDefault();
    try {
        await signOut(auth);
    } catch (error) {
        console.warn("Firebase signOut failed:", error?.message || error);
    } finally {
        localStorage.clear();
        location.href = "Login.html";
    }
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
        if (!btn) return;
        const originalText = btn.textContent;
        btn.textContent = 'Message Sent!';
        btn.style.background = '#4ade80';
        setTimeout(() => { btn.textContent = originalText; btn.style.background = ''; contactForm.reset(); }, 3000);
    });
}

// =========================
// SAVE SUBJECTS TO FIRESTORE
// =========================
async function saveSubjectsToFirestore() {
    const userData = JSON.parse(localStorage.getItem("userData"));
    let courseId = normalizeCourseId(userData?.course);
    if (!userData || !courseId) {
        console.log("No course data, skipping Firestore save.");
        return false;
    }

    const serverProfile = await getServerUserProfile();
    if (!serverProfile || serverProfile.source === "none") {
        console.warn("Skipping Firestore save: no server profile found for current user.");
        return false;
    }

    const serverRole = normalizeRole(serverProfile.role);
    const serverCourse = normalizeCourseId(serverProfile.course);
    const localRole = normalizeRole(userData.role);
    const localCourse = normalizeCourseId(userData.course);

    if (!serverCourse) {
        console.warn("Skipping Firestore save: server profile has no course assigned.");
        return false;
    }

    if (localRole !== serverRole || localCourse !== serverCourse) {
        const mergedUserData = { ...userData, role: serverRole || userData.role, course: serverCourse || userData.course };
        localStorage.setItem("userData", JSON.stringify(mergedUserData));
        console.warn("Updated local userData from server profile for sync consistency.", {
            localRole,
            serverRole,
            localCourse,
            serverCourse
        });
    }

    courseId = serverCourse || courseId;
    if (!isInstructorRoleValue(serverRole)) {
        console.log("Skipping Firestore save for non-instructor server role:", serverRole);
        return false;
    }

    // Enforce limit before saving to Firestore
    if (subjects.length > MAX_SUBJECTS_LIMIT) {
        console.warn(`Subjects count (${subjects.length}) exceeds limit of ${MAX_SUBJECTS_LIMIT}. Truncating before save...`);
        subjects = subjects.slice(0, MAX_SUBJECTS_LIMIT);
    }

    console.log("Saving subjects to Firestore for course:", courseId);
    console.log("Subjects to save:", subjects);
    
    isSavingSubjects = true; // Set flag before saving to prevent realtime loop
    
    try {
        const subjectsHash = JSON.stringify(subjects);
        if (subjectsHash === lastSyncedSubjectsHash) {
            console.log("Skipping Firestore save: no subject changes since last sync.");
            isSavingSubjects = false;
            return true;
        }

        await setDoc(doc(db, "subjects", courseId), {
            subjects: subjects,
            lastUpdated: serverTimestamp()
        });
        lastSyncedSubjectsHash = subjectsHash;
        disableSubjectsRealtime = false;
        console.log("Subjects synced to cloud successfully!");
        // Reset the saving flag after a short delay to allow Firestore to propagate
        setTimeout(() => {
            isSavingSubjects = false;
            console.log("Saving flag reset, ready for realtime updates");
        }, 1000);
        return true;
    } catch (error) {
        console.error("Error saving subjects to Firestore:", error.code, error.message);
        isSavingSubjects = false;
        if (error.code === 'permission-denied' || error.message?.includes('permission')) {
            try {
                const serverProfile = await getServerUserProfile();
                if (serverProfile) {
                    console.warn('Permission debug - server profile:', {
                        source: serverProfile.source,
                        uid: serverProfile.uid,
                        role: serverProfile.role,
                        course: serverProfile.course
                    });
                    console.warn('Permission debug - local profile:', {
                        role: localRole,
                        course: localCourse
                    });
                }
            } catch (profileError) {
                console.warn("Could not fetch server profile for permission debug:", profileError.message);
            }

            // Keep student realtime listener active; only instructors fall back to local edit mode.
            if (canSyncCourseData(userData)) {
                disableSubjectsRealtime = true;
                if (typeof subjectsRealtimeUnsubscribe === 'function') {
                    subjectsRealtimeUnsubscribe();
                    subjectsRealtimeUnsubscribe = null;
                }
                console.warn("Cloud write denied for instructor. Continuing in local edit mode.");
            } else {
                console.warn("Cloud write denied for non-instructor; realtime listener remains active.");
            }
        }
        return false;
    }
}

function scheduleSubjectsSync(delayMs = 1200) {
    if (syncTimer) {
        clearTimeout(syncTimer);
    }

    syncTimer = setTimeout(() => {
        syncTimer = null;
        saveSubjectsToFirestore();
    }, delayMs);
}

// Save a student submission into Firestore subcollections
async function saveStudentSubmissionToFirestore({ type, subject, item, fileName, fileUrl }) {
    const userData = JSON.parse(localStorage.getItem("userData"));
    const courseId = normalizeCourseId(userData?.course);
    const firebaseUser = auth.currentUser || await waitForAuthReady();
    const studentId = firebaseUser?.uid || null;

    if (!firebaseUser) {
        throw new Error("Firebase auth is not ready. Please log in again and retry.");
    }

    if (!userData || !studentId || !courseId) {
        throw new Error("Missing user session data for submission.");
    }

    const collectionName = type === "task" ? "tasks" : type === "assignment" ? "assignments" : type === "quiz" ? "quizzes" : "items";
    const itemId = item?.id;
    if (!itemId) {
        throw new Error("This item is missing its ID. Please refresh and try again.");
    }

    const itemRef = doc(db, "subjects", courseId, collectionName, itemId);
    const submissionRef = doc(db, "subjects", courseId, collectionName, itemId, "submissions", studentId);

    // Only instructors can write parent assignment/task/quiz docs by rules.
    // Student submissions should write directly to the submissions subcollection.
    if (isInstructorRoleValue(userData?.role)) {
        await setDoc(itemRef, {
            subjectId: subject.id || "",
            subjectName: subject.name || "",
            title: item.title || "",
            dueDate: item.dueDate || "",
            updatedAt: serverTimestamp()
        }, { merge: true });
    }

    await setDoc(submissionRef, {
        studentId,
        studentName: userData.name || "",
        fileName,
        fileUrl,
        submittedAt: serverTimestamp()
    }, { merge: true });
}

async function fetchItemSubmissionsFromFirestore(type, itemId) {
    const userData = JSON.parse(localStorage.getItem("userData") || "{}");
    const courseId = normalizeCourseId(userData?.course);
    if (!courseId || !itemId) return [];

    const collectionName = type === "task" ? "tasks" : type === "assignment" ? "assignments" : type === "quiz" ? "quizzes" : "items";
    const submissionsRef = collection(db, "subjects", courseId, collectionName, itemId, "submissions");
    const submissionsSnap = await getDocs(submissionsRef);

    const submissions = [];
    submissionsSnap.forEach((submissionDoc) => {
        submissions.push({ id: submissionDoc.id, ...submissionDoc.data() });
    });
    return submissions;
}

// =========================
// LOAD SUBJECTS FROM FIRESTORE
// =========================
async function loadSubjectsFromFirestore(courseId, onLoad) {
    try {
        const normalizedCourseId = normalizeCourseId(courseId);
        if (!normalizedCourseId) {
            console.warn("loadSubjectsFromFirestore called without valid courseId");
            return false;
        }

        const docRef = doc(db, "subjects", normalizedCourseId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            subjects = normalizeSubjects(docSnap.data().subjects || subjects);
            localStorage.setItem('subjects', JSON.stringify(subjects)); // Save to localStorage
            lastSyncedSubjectsHash = JSON.stringify(subjects);
            if (onLoad) onLoad();
            return true;
        } else {
            // If no Firestore data, save local data to Firestore for first time
            saveSubjectsToFirestore();
            return true;
        }
    } catch (error) {
        // Only log permission errors as warnings, other errors as errors
        if (error.code === 'permission-denied' || error.message.includes('permission')) {
            console.warn("Firestore permission denied - using local data only");
        } else {
            console.warn("Error loading from Firestore:", error.message);
        }
        return false;
    }
}

// =========================
// SUBJECTS PAGE FUNCTIONALITY
// =========================
function initializeSubjects() {
    debugLog('initializeSubjects called');

    // This initializer is only for Subjects page UI.
    const isSubjectsPage = window.location.pathname.toLowerCase().includes('subjects.html');
    if (!isSubjectsPage) {
        return;
    }
    
    const listContainer = document.getElementById('subjectsList');
    const detailsContainer = document.getElementById('subjectDetailsPanel');
    const addBtn = document.getElementById('addSubjectBtn');
    const addModal = document.getElementById('addSubjectModal');
    const addForm = document.getElementById('addSubjectForm');
    const editModal = document.getElementById('editSubjectModal');
    const editForm = document.getElementById('editSubjectForm');
    const deleteBtn = document.getElementById('deleteSubjectBtn');

    debugLog('Elements found:', {
        listContainer: !!listContainer,
        detailsContainer: !!detailsContainer,
        addBtn: !!addBtn,
        addModal: !!addModal,
        addForm: !!addForm,
        editModal: !!editModal,
        editForm: !!editForm,
        deleteBtn: !!deleteBtn
    });

    if (!listContainer || !detailsContainer) {
        console.warn('Subjects page is missing required elements; skipping subjects initialization.');
        return;
    }

    // Get user role
    let userData = JSON.parse(localStorage.getItem("userData"));
    let courseId = normalizeCourseId(userData?.course);
    const userRole = (userData?.role || 'student').toLowerCase();
    const isInstructorRole = userRole === 'instructor' || userRole === 'teacher' || userRole === 'admin';
    debugLog('User role:', userRole);
    debugLog('Add button element:', addBtn);

    // Hide add subject button for students (instructor-only feature)
    const addSubjectBtn = document.getElementById('addSubjectBtn');
    if (addSubjectBtn) {
        if (!isInstructorRole) {
            addSubjectBtn.style.display = 'none';
        } else {
            addSubjectBtn.style.display = 'flex';
        }
    }

    // subjects is now defined globally at the top of the file
    let isSubjectsLoading = !!(userData && userData.course);

    // -------------------------
    // RENDER SUBJECTS - SIDEBAR
    // -------------------------
    const renderSubjects = function() {
        if (isSubjectsLoading) {
            listContainer.innerHTML = '<div class="empty-state"><p>Loading subjects...</p></div>';
            return;
        }

        if (!subjects.length) {
            listContainer.innerHTML = '<div class="empty-state"><p>No subjects assigned yet.</p></div>';
            return;
        }

        listContainer.innerHTML = subjects.map((sub, index) => `
            <div class="subject-list-item" data-index="${index}">
                <div class="subject-item-content">
                    <h4><i class="fas fa-book"></i> ${sub.name}</h4>
                    <p><i class="fas fa-chalkboard-teacher"></i> ${sub.teacher}</p>
                </div>
            </div>
        `).join('');

        // Add click listeners for subject items
        document.querySelectorAll('.subject-list-item').forEach(item => {
            item.addEventListener('click', function() {
                // Remove active class from all
                document.querySelectorAll('.subject-list-item').forEach(i => i.classList.remove('active'));
                // Add active to clicked
                this.classList.add('active');
                // Show details
                const index = parseInt(this.dataset.index);
                renderSubjectDetails(index);
            });
        });
    }

    // Load subjects from Firestore after Firebase Auth is ready.
    if (userData && userData.course) {
        let cloudInitialized = false;

        const initializeCloudSync = () => {
            if (cloudInitialized) return;
            cloudInitialized = true;

            subjectsRealtimeUnsubscribe = setupRealtimeSubjects(courseId, (updatedSubjects) => {
                // Skip if realtime is disabled or if we're currently saving (prevents loop)
                if (disableSubjectsRealtime || isSavingSubjects) {
                    debugLog("Skipping realtime update - disabled or saving");
                    return;
                }

                // Null means "course doc missing" from realtime.js; keep current local list.
                if (!Array.isArray(updatedSubjects)) {
                    console.warn("Realtime subjects payload is empty/missing. Preserving current local subjects.");
                    isSubjectsLoading = false;
                    renderSubjects();
                    return;
                }

                // When subjects update, stop existing task listeners and re-setup
                stopTaskListeners();
                isSubjectsLoading = false;
                subjects = normalizeSubjects(updatedSubjects);
                localStorage.setItem('subjects', JSON.stringify(subjects)); // Save to localStorage only
                lastSyncedSubjectsHash = JSON.stringify(subjects);
                renderSubjects();
                // Re-render current subject details if any
                const activeItem = document.querySelector('.subject-list-item.active');
                if (activeItem) {
                    renderSubjectDetails(activeItem.dataset.index);
                }
                // Setup task listeners for all subjects
                setupTaskListeners();
                debugLog("Realtime update: Subjects refreshed from cloud.");
            }, (error) => {
                console.warn("Realtime connection failed, using local data only:", error.message);
                isSubjectsLoading = false;
                renderSubjects();
            });

            loadSubjectsFromFirestore(courseId).then(() => {
                // Setup task listeners after subjects are loaded
                setupTaskListeners();
                isSubjectsLoading = false;
                renderSubjects();
            }).catch((error) => {
                console.warn("Cloud sync unavailable - using local data:", error.message);
                isSubjectsLoading = false;
                renderSubjects();
            });
        };

        const authUnsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (!firebaseUser) {
                return;
            }

            try {
                const profile = await getUserProfileByUid(firebaseUser.uid);
                if (profile?.data) {
                    const serverCourse = normalizeCourseId(profile.data.course);
                    const serverRole = normalizeRole(profile.data.role);
                    if (serverCourse) {
                        courseId = serverCourse;
                        userData = {
                            ...userData,
                            id: firebaseUser.uid,
                            role: serverRole || userData?.role,
                            course: serverCourse
                        };
                        localStorage.setItem("userData", JSON.stringify(userData));
                    }
                }
            } catch (profileError) {
                console.warn("Could not refresh server profile before realtime init:", profileError.message);
            }

            initializeCloudSync();
            // We only need this once for subjects initialization.
            authUnsubscribe();
        });

        // Fast path when auth is already available.
        if (auth.currentUser) {
            (async () => {
                try {
                    const profile = await getUserProfileByUid(auth.currentUser.uid);
                    if (profile?.data) {
                        const serverCourse = normalizeCourseId(profile.data.course);
                        const serverRole = normalizeRole(profile.data.role);
                    if (serverCourse) {
                        courseId = serverCourse;
                            userData = {
                                ...userData,
                                id: auth.currentUser.uid,
                                role: serverRole || userData?.role,
                                course: serverCourse
                            };
                            localStorage.setItem("userData", JSON.stringify(userData));
                        }
                    }
                } catch (profileError) {
                    console.warn("Could not refresh server profile before realtime init:", profileError.message);
                }

                initializeCloudSync();
                authUnsubscribe();
            })();
        } else {
            // Fallback UI render while waiting for auth state.
            renderSubjects();
            debugLog("Waiting for Firebase auth before attaching realtime subjects listener...");
        }
    } else {
        debugLog("No user course data, using localStorage data only");
        renderSubjects();
    }

    // -------------------------
    // RENDER DETAILS
    // -------------------------
    const renderSubjectDetails = function(index) {
        const sub = subjects[index];
        if (!sub) return;

        const isInstructor = isInstructorRole;
        debugLog('User role in renderSubjectDetails:', userRole);
        debugLog('Rendering for instructor:', isInstructor);

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
                <button class="btn-edit-subject" data-index="${index}" onclick="window.subjectsOpenEditModal(${index})">
                    <i class="fas fa-edit"></i> Edit
                </button>
                <button class="btn-sync-cloud" data-index="${index}" onclick="window.subjectsSyncToCloud()">
                    <i class="fas fa-cloud-upload-alt"></i> Sync to Cloud
                </button>
            </div>
            ` : ''}
            </div>

            <div class="subject-tabs">
                <button class="tab-btn active" data-tab="tasks" onclick="window.subjectsSwitchTab('tasks')">Tasks</button>
                <button class="tab-btn" data-tab="assignments" onclick="window.subjectsSwitchTab('assignments')">Assignments</button>
                <button class="tab-btn" data-tab="lessons" onclick="window.subjectsSwitchTab('lessons')">Lessons</button>
                <button class="tab-btn" data-tab="quizzes" onclick="window.subjectsSwitchTab('quizzes')">Quizzes</button>
            </div>

            <div class="tab-content active" id="tasks-tab">
                <div class="items-container">
                    <div class="items-header">
                        <h3><i class="fas fa-tasks"></i> Tasks</h3>
                        ${isInstructor ? `<button class="btn-add-item" data-type="task" data-subject-index="${index}" onclick="window.subjectsOpenAddItemModal(${index}, 'task')">
                            <i class="fas fa-plus"></i> Add Task
                        </button>` : ''}
                    </div>
                    <div class="items-list">
                        ${sub.tasks.length > 0 ? sub.tasks.map((task, i) => `
                            <div class="item-card">
                                <div class="item-info">
                                    <h4>${task.title}</h4>
                                    <p class="task-status-line" data-task-status-id="${task.id || ''}">Due: ${task.dueDate} | Priority: ${task.priority} | Status: ${task.status}</p>
                                    <p>${task.description}</p>
                                    ${(task.file || task.fileName) ? `<p><i class="fas fa-paperclip"></i> <a href="${task.fileUrl || task.url || '#'}" target="_blank">${task.file || task.fileName}</a></p>` : ''}
                                    ${isInstructor ? `
                                    <div class="instructor-actions">
                                        <button class="btn-view-submissions" data-subject-index="${index}" onclick="window.subjectsOpenGradesForItem(${index}, 'task', '${task.id || ''}')">
                                            <i class="fas fa-chart-bar"></i> Open in Submissions
                                        </button>
                                    </div>
                                    ` : `
                                    <div class="student-actions">
                                        <button class="btn-submit-task" data-task-index="${i}" data-subject-index="${index}" onclick="window.subjectsOpenSubmitTaskModal(${index}, ${i})">
                                            <i class="fas fa-upload"></i> Submit Task
                                        </button>
                                        <p class="task-submitted-indicator" data-task-submitted-id="${task.id || ''}" style="${task.submissions && task.submissions.find(s => (s.studentId || s.id) === userData.id) ? '' : 'display:none;'}"><i class="fas fa-check"></i> Submitted</p>
                                    </div>
                                    `}
                                </div>
                                ${isInstructor ? `
                                <div class="item-actions">
                                    <button class="btn-edit-item" data-type="task" data-item-index="${i}" data-subject-index="${index}" onclick="window.subjectsOpenEditItemModal(${index}, 'task', ${i})">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn-delete-item" data-type="task" data-item-index="${i}" data-subject-index="${index}" onclick="window.subjectsDeleteItem(${index}, 'task', ${i})">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                                ` : ''}
                            </div>
                        `).join('') : `<div class="empty-state"><i class="fas fa-tasks"></i><p>No tasks yet.</p></div>`}
                    </div>
                </div>
            </div>

            <div class="tab-content" id="assignments-tab">
                <div class="items-container">
                    <div class="items-header">
                        <h3><i class="fas fa-clipboard-list"></i> Assignments</h3>
                        ${isInstructor ? `<button class="btn-add-item" data-type="assignment" data-subject-index="${index}" onclick="window.subjectsOpenAddItemModal(${index}, 'assignment')">
                            <i class="fas fa-plus"></i> Add Assignment
                        </button>` : ''}
                    </div>
                    <div class="items-list">
                        ${sub.assignments.length > 0 ? sub.assignments.map((assignment, i) => `
                            <div class="item-card">
                                <div class="item-info">
                                    <h4>${assignment.title}</h4>
                                    <p>Due: ${assignment.dueDate} | Points: ${assignment.points} | Status: ${assignment.status}</p>
                                    <p>${assignment.instructions}</p>
                                    ${assignment.file ? `<p><i class="fas fa-paperclip"></i> <a href="${assignment.fileUrl}" target="_blank">${assignment.file}</a></p>` : ''}
                                    ${isInstructor ? `
                                    <div class="instructor-actions">
                                        <button class="btn-view-submissions" data-subject-index="${index}" onclick="window.subjectsOpenGradesForItem(${index}, 'assignment', '${assignment.id || ''}')">
                                            <i class="fas fa-chart-bar"></i> Open in Submissions
                                        </button>
                                    </div>
                                    ` : `
                                    <div class="student-actions">
                                        <button class="btn-submit-assignment" data-assignment-index="${i}" data-subject-index="${index}" onclick="window.subjectsOpenSubmitAssignmentModal(${index}, ${i})">
                                            <i class="fas fa-upload"></i> Submit Assignment
                                        </button>
                                        ${assignment.submissions && assignment.submissions.find(s => s.studentId === userData.id) ? '<p><i class="fas fa-check"></i> Submitted</p>' : ''}
                                    </div>
                                    `}
                                </div>
                                ${isInstructor ? `
                                <div class="item-actions">
                                    <button class="btn-edit-item" data-type="assignment" data-item-index="${i}" data-subject-index="${index}" onclick="window.subjectsOpenEditItemModal(${index}, 'assignment', ${i})">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn-delete-item" data-type="assignment" data-item-index="${i}" data-subject-index="${index}" onclick="window.subjectsDeleteItem(${index}, 'assignment', ${i})">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                                ` : ''}
                            </div>
                        `).join('') : `<div class="empty-state"><i class="fas fa-clipboard-list"></i><p>No assignments yet.</p></div>`}
                    </div>
                </div>
            </div>

            <div class="tab-content" id="lessons-tab">
                <div class="items-container">
                    <div class="items-header">
                        <h3><i class="fas fa-book-open"></i> Lessons</h3>
                        ${isInstructor ? `<button class="btn-add-item" data-type="lesson" data-subject-index="${index}" onclick="window.subjectsOpenAddItemModal(${index}, 'lesson')">
                            <i class="fas fa-plus"></i> Add Lesson
                        </button>` : ''}
                    </div>
                    <div class="items-list">
                        ${sub.lessons.length > 0 ? sub.lessons.map((lesson, i) => `
                            <div class="item-card">
                                <div class="lesson-info">
                                    <h4>${lesson.title}</h4>
                                    <p><i class="fas fa-clock"></i> ${lesson.duration} • ${lesson.status}</p>
                                    <p>${lesson.content}</p>
                                    ${lesson.file ? `<p><i class="fas fa-paperclip"></i> <a href="${lesson.fileUrl}" target="_blank">${lesson.file}</a></p>` : ''}
                                </div>
                                ${isInstructor ? `
                                <div class="item-actions">
                                    <button class="btn-edit-item" data-type="lesson" data-item-index="${i}" data-subject-index="${index}" onclick="window.subjectsOpenEditItemModal(${index}, 'lesson', ${i})">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn-delete-item" data-type="lesson" data-item-index="${i}" data-subject-index="${index}" onclick="window.subjectsDeleteItem(${index}, 'lesson', ${i})">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                                ` : ''}
                            </div>
                        `).join('') : `<div class="empty-state"><i class="fas fa-book-open"></i><p>No lessons yet.</p></div>`}
                    </div>
                </div>
            </div>

            <div class="tab-content" id="quizzes-tab">
                <div class="items-container">
                    <div class="items-header">
                        <h3><i class="fas fa-question-circle"></i> Quizzes</h3>
                        ${isInstructor ? `<button class="btn-add-item" data-type="quiz" data-subject-index="${index}" onclick="window.subjectsOpenAddItemModal(${index}, 'quiz')">
                            <i class="fas fa-plus"></i> Add Quiz
                        </button>` : ''}
                    </div>
                    <div class="items-list">
                        ${sub.quizzes.length > 0 ? sub.quizzes.map((quiz, i) => `
                            <div class="item-card">
                                <div class="item-info">
                                    <h4>${quiz.title || 'Untitled Quiz'}</h4>
                                    <p>Due: ${quiz.dueDate || 'N/A'} | Points: ${quiz.points || 0} | Status: ${quiz.status || 'available'}</p>
                                    ${quiz.instructions ? `<p>${quiz.instructions}</p>` : ''}
                                    ${quiz.submissions?.length > 0 ? `<p class="submission-count" data-quiz-id="${quiz.id}"><i class="fas fa-users"></i> ${quiz.submissions.length} submission${quiz.submissions.length !== 1 ? 's' : ''}</p>` : ''}
                                </div>
                                ${isInstructor ? `
                                <div class="item-actions">
                                    <button class="btn-edit-item" data-type="quiz" data-item-index="${i}" data-subject-index="${index}" onclick="window.subjectsOpenEditItemModal(${index}, 'quiz', ${i})">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn-view-submissions" data-subject-index="${index}" onclick="window.subjectsOpenGradesForItem(${index}, 'quiz', '${quiz.id || ''}')" title="Open in Submissions">
                                        <i class="fas fa-users"></i>
                                    </button>
                                    <button class="btn-delete-item" data-type="quiz" data-item-index="${i}" data-subject-index="${index}" onclick="window.subjectsDeleteItem(${index}, 'quiz', ${i})">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                                ` : `
                                <div class="item-actions">
                                    ${quiz?.quizLink ? `<a href="${quiz.quizLink}" target="_blank" class="btn-take-quiz" title="Take Quiz">
                                        <i class="fas fa-play"></i> Take Quiz
                                    </a>` : `<span style="color: var(--text-secondary); font-size: 0.85em;">No quiz available</span>`}
                                    <button class="btn-submit-assignment" onclick="window.subjectsOpenSubmitQuizModal(${index}, ${i})" title="Submit Quiz">
                                        <i class="fas fa-check"></i> Mark as Done
                                    </button>
                                </div>
                                `}
                            </div>
                        `).join('') : `<div class="empty-state"><i class="fas fa-question-circle"></i><p>No quizzes available yet.</p></div>`}
                    </div>
                </div>
            </div>
        `;

        // Only switch to tasks tab on initial render, not on re-renders
        const currentTab = document.querySelector('.tab-btn.active');
        if (!currentTab) {
            switchTab('tasks');
        }
        setupAssignmentSubmissionCountListeners(index, courseId);
        hydrateSubmissionCountsForSubject(index, courseId);

    };



    // -------------------------
    // OPEN ADD SUBJECT MODAL
    // -------------------------
    addBtn?.addEventListener('click', () => {
        if (addModal) {
            addModal.style.display = 'block';
        }
    });

    // -------------------------
    // OPEN EDIT MODAL
    // -------------------------
    const openEditModal = (index) => {
        // Prevent students from editing subjects
        if (!isInstructorRole) {
            alert('Only instructors can edit subjects.');
            return;
        }

        const sub = subjects[index];
        if (!sub) return;

        document.getElementById('editSubjectIndex').value = index;
        document.getElementById('editSubjectName').value = sub.name;
        document.getElementById('editTeacherName').value = sub.teacher;
        document.getElementById('editSubjectDay').value = extractDayFromTime(sub.time);
        document.getElementById('editSubjectTime').value = extractTimeFromTime(sub.time);
        document.getElementById('editSubjectDescription').value = sub.description || '';

        editModal.style.display = 'block';
    }





    // -------------------------
    // CLOSE MODALS
    // -------------------------
    const closeAllModals = function() {
        document.querySelectorAll('.modal').forEach(modal => {
            // Remove dynamically created quiz/submission modals to avoid duplicate IDs
            if (['addQuizModal', 'editQuizModal', 'submitQuizModal', 'viewQuizSubmissionsModal'].includes(modal.id)) {
                modal.remove();
            } else {
                modal.style.display = 'none';
            }
        });
    }

    const switchTab = function(tab) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
        const tabContent = document.getElementById(`${tab}-tab`);
        if (tabBtn) tabBtn.classList.add('active');
        if (tabContent) tabContent.classList.add('active');
    }

    // Hybrid/failsafe modal submit handler.
    // Captures submits before per-form listeners so core actions always work.
    document.addEventListener('submit', async (e) => {
        const form = e.target;
        if (!(form instanceof HTMLFormElement)) return;

        try {
            if (form.id === 'addSubjectForm') {
                e.preventDefault();
                e.stopImmediatePropagation();

                // Check if we've reached the maximum limit
                if (subjects.length >= MAX_SUBJECTS_LIMIT) {
                    alert(`Cannot add more subjects. Maximum limit of ${MAX_SUBJECTS_LIMIT} subjects reached.`);
                    return;
                }

                const subject = {
                    id: Date.now().toString(),
                    name: document.getElementById('newSubjectName').value.trim(),
                    teacher: document.getElementById('newTeacherName').value.trim(),
                    time: combineDayAndTime(document.getElementById('newSubjectDay').value, document.getElementById('newSubjectTime').value.trim()),
                    description: document.getElementById('newSubjectDescription').value.trim(),
                    lessons: [],
                    tasks: [],
                    assignments: [],
                    quizzes: []
                };

                subjects.push(subject);
                saveSubjects();
                renderSubjects();
                form.reset();
                if (addModal) addModal.style.display = 'none';
                return;
            }

            if (form.id === 'editSubjectForm') {
                e.preventDefault();
                e.stopImmediatePropagation();

                // Prevent students from editing subjects
                if (!isInstructorRole) {
                    alert('Only instructors can edit subjects.');
                    closeAllModals();
                    return;
                }

                const index = parseInt(document.getElementById('editSubjectIndex').value);
                if (Number.isNaN(index) || !subjects[index]) return;

                subjects[index] = {
                    ...subjects[index],
                    name: document.getElementById('editSubjectName').value.trim(),
                    teacher: document.getElementById('editTeacherName').value.trim(),
                    time: combineDayAndTime(document.getElementById('editSubjectDay').value, document.getElementById('editSubjectTime').value.trim()),
                    description: document.getElementById('editSubjectDescription').value.trim()
                };

                saveSubjects();
                renderSubjects();
                renderSubjectDetails(index);
                closeAllModals();
                return;
            }

            if (form.id === 'addTaskForm') {
                e.preventDefault();
                e.stopImmediatePropagation();

                const subjectIndex = parseInt(document.getElementById('taskSubjectIndex').value);
                const sub = subjects[subjectIndex];
                if (!sub) return;

                const task = {
                    id: Date.now().toString(),
                    title: document.getElementById('newTaskTitle').value.trim(),
                    dueDate: document.getElementById('newTaskDueDate').value,
                    priority: document.getElementById('newTaskPriority').value,
                    status: 'pending',
                    description: document.getElementById('newTaskDescription').value.trim(),
                    file: null,
                    fileUrl: null
                };

                const fileInput = document.getElementById('newTaskFile');
                if (fileInput?.files?.[0]) {
                    const file = fileInput.files[0];
                    task.file = file.name;
                    task.fileUrl = await uploadFileToSupabase(file, `subjects/${sub.id}/${task.id}/`);
                }

                sub.tasks.push(task);
                saveSubjects();
                renderSubjectDetails(subjectIndex);
                form.reset();
                const modal = document.getElementById('addTaskModal');
                if (modal) modal.style.display = 'none';
                return;
            }

            if (form.id === 'addAssignmentForm') {
                e.preventDefault();
                e.stopImmediatePropagation();

                const subjectIndex = parseInt(document.getElementById('assignmentSubjectIndex').value);
                const sub = subjects[subjectIndex];
                if (!sub) return;

                const assignment = {
                    id: Date.now().toString(),
                    title: document.getElementById('newAssignmentTitle').value.trim(),
                    dueDate: document.getElementById('newAssignmentDueDate').value,
                    points: parseInt(document.getElementById('newAssignmentPoints').value),
                    status: document.getElementById('newAssignmentStatus').value,
                    instructions: document.getElementById('newAssignmentInstructions').value.trim(),
                    file: null,
                    fileUrl: null,
                    submissions: []
                };

                const fileInput = document.getElementById('newAssignmentFile');
                if (fileInput?.files?.[0]) {
                    const file = fileInput.files[0];
                    assignment.file = file.name;
                    assignment.fileUrl = await uploadFileToSupabase(file, `subjects/${sub.id}/${assignment.id}/`);
                }

                sub.assignments.push(assignment);
                saveSubjects();
                renderSubjectDetails(subjectIndex);
                form.reset();
                const modal = document.getElementById('addAssignmentModal');
                if (modal) modal.style.display = 'none';
                return;
            }

            if (form.id === 'addLessonForm') {
                e.preventDefault();
                e.stopImmediatePropagation();

                const subjectIndex = parseInt(document.getElementById('lessonSubjectIndex').value);
                const sub = subjects[subjectIndex];
                if (!sub) return;

                const lesson = {
                    id: Date.now().toString(),
                    title: document.getElementById('newLessonTitle').value.trim(),
                    duration: document.getElementById('newLessonDuration').value.trim(),
                    status: document.getElementById('newLessonStatus').value,
                    content: document.getElementById('newLessonContent').value.trim(),
                    file: null,
                    fileUrl: null
                };

                const fileInput = document.getElementById('newLessonFile');
                if (fileInput?.files?.[0]) {
                    const file = fileInput.files[0];
                    lesson.file = file.name;
                    lesson.fileUrl = await uploadFileToSupabase(file, `subjects/${sub.id}/${lesson.id}/`);
                }

                sub.lessons.push(lesson);
                saveSubjects();
                renderSubjectDetails(subjectIndex);
                form.reset();
                const modal = document.getElementById('addLessonModal');
                if (modal) modal.style.display = 'none';
                return;
            }
        } catch (err) {
            console.error('Subjects form submit failed:', err);
            alert(err.message || 'Action failed. Check console for details.');
        }
    }, true);

    // Event delegation for dynamic details buttons (robust across re-renders).
    detailsContainer.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.tab-btn');
        if (tabBtn) {
            switchTab(tabBtn.dataset.tab);
            return;
        }

        const addItemBtn = e.target.closest('.btn-add-item');
        if (addItemBtn) {
            openAddItemModal(parseInt(addItemBtn.dataset.subjectIndex), addItemBtn.dataset.type);
            return;
        }

        const editItemBtn = e.target.closest('.btn-edit-item');
        if (editItemBtn) {
            openEditItemModal(
                parseInt(editItemBtn.dataset.subjectIndex),
                editItemBtn.dataset.type,
                parseInt(editItemBtn.dataset.itemIndex)
            );
            return;
        }

        const deleteItemBtn = e.target.closest('.btn-delete-item');
        if (deleteItemBtn) {
            deleteItem(
                parseInt(deleteItemBtn.dataset.subjectIndex),
                deleteItemBtn.dataset.type,
                parseInt(deleteItemBtn.dataset.itemIndex)
            );
            return;
        }

        const submitAssignmentBtn = e.target.closest('.btn-submit-assignment');
        if (submitAssignmentBtn) {
            openSubmitAssignmentModal(
                parseInt(submitAssignmentBtn.dataset.subjectIndex),
                parseInt(submitAssignmentBtn.dataset.assignmentIndex)
            );
            return;
        }

        const syncCloudBtn = e.target.closest('.btn-sync-cloud');
        if (syncCloudBtn) {
            saveSubjects(false);
            saveSubjectsToFirestore();
            return;
        }

        const editSubjectBtn = e.target.closest('.btn-edit-subject');
        if (editSubjectBtn) {
            openEditModal(parseInt(editSubjectBtn.dataset.index));
        }
    });

    document.querySelectorAll('.modal .close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    window.addEventListener('click', e => {
        if (e.target.classList.contains('modal')) {
            closeAllModals();
        }
    });





    // add/edit subject form submit is handled by the captured hybrid listener above.

    // -------------------------
    // DELETE SUBJECT
    // -------------------------
    deleteBtn?.addEventListener('click', () => {
        // Prevent students from deleting subjects
        if (!isInstructorRole) {
            alert('Only instructors can delete subjects.');
            return;
        }

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

    // add task form submit is handled by the captured hybrid listener above.

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
        let { file: fileName, fileUrl, id: taskId, submissions } = sub.tasks[itemIndex];

        if (fileInput.files[0]) {
            const file = fileInput.files[0];
            fileName = file.name;
            fileUrl = await uploadFileToSupabase(file, `subjects/${sub.id}/${taskId}/`);
        }

        sub.tasks[itemIndex] = {
            id: taskId,
            title: document.getElementById('editTaskTitle').value.trim(),
            dueDate: document.getElementById('editTaskDueDate').value,
            priority: document.getElementById('editTaskPriority').value,
            status: document.getElementById('editTaskStatus').value,
            description: document.getElementById('editTaskDescription').value.trim(),
            file: fileName,
            fileUrl: fileUrl,
            submissions: submissions || []
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

    // add assignment form submit is handled by the captured hybrid listener above.

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
        const { file, fileUrl, id: assignmentId } = sub.assignments[itemIndex];
        let fileName = file;
        let updatedFileUrl = fileUrl;

        if (fileInput.files[0]) {
            const file = fileInput.files[0];
            fileName = file.name;
            updatedFileUrl = await uploadFileToSupabase(file, `subjects/${sub.id}/${assignmentId}/`);
        }

        sub.assignments[itemIndex] = {
            id: assignmentId,
            title: document.getElementById('editAssignmentTitle').value.trim(),
            dueDate: document.getElementById('editAssignmentDueDate').value,
            points: parseInt(document.getElementById('editAssignmentPoints').value),
            status: document.getElementById('editAssignmentStatus').value,
            instructions: document.getElementById('editAssignmentInstructions').value.trim(),
            file: fileName,
            fileUrl: updatedFileUrl,
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

    // add lesson form submit is handled by the captured hybrid listener above.

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
        let { file: fileName, fileUrl, id: lessonId } = sub.lessons[itemIndex];

        if (fileInput.files[0]) {
            const file = fileInput.files[0];
            fileName = file.name;
            fileUrl = await uploadFileToSupabase(file, `subjects/${sub.id}/${sub.lessons[itemIndex].id}/`);
        }

        sub.lessons[itemIndex] = {
            id: lessonId,
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
    const openAddItemModal = function(subjectIndex, type) {
        if (type === 'quiz') {
            // Remove any existing quiz modal to avoid duplicate IDs
            const existingModal = document.getElementById('addQuizModal');
            if (existingModal) existingModal.remove();

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
                                <label>Google Form Link</label>
                                <input type="url" id="newQuizLink" placeholder="e.g. https://forms.gle/..." />
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
                    id: Date.now().toString(),
                    title: document.getElementById('newQuizTitle').value.trim(),
                    dueDate: document.getElementById('newQuizDueDate').value,
                    points: parseInt(document.getElementById('newQuizPoints').value),
                    status: 'available',
                    instructions: document.getElementById('newQuizInstructions').value.trim(),
                    quizLink: document.getElementById('newQuizLink').value.trim(),
                    submissions: []
                };
                sub.quizzes.push(quiz);
                saveSubjects();
                renderSubjectDetails(subjectIndex);
                // Switch to quizzes tab to show the new quiz
                switchTab('quizzes');
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
    const openEditItemModal = function(subjectIndex, type, itemIndex) {
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const arrayName = type === 'quiz' ? 'quizzes' : `${type}s`;
        const item = sub[arrayName]?.[itemIndex];
        if (!item) return;

        if (type === 'quiz') {
            // Remove any existing edit quiz modal to avoid duplicate IDs
            const existingModal = document.getElementById('editQuizModal');
            if (existingModal) existingModal.remove();

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
                                <input type="text" id="editQuizTitle" required value="${item.title || ''}" />
                            </div>
                            <div class="form-group">
                                <label>Due Date</label>
                                <input type="date" id="editQuizDueDate" required value="${item.dueDate || ''}" />
                            </div>
                            <div class="form-group">
                                <label>Points</label>
                                <input type="number" id="editQuizPoints" required value="${item.points || 0}" />
                            </div>
                            <div class="form-group">
                                <label>Google Form Link</label>
                                <input type="url" id="editQuizLink" value="${item.quizLink || ''}" placeholder="e.g. https://forms.gle/..." />
                            </div>
                            <div class="form-group">
                                <label>Instructions</label>
                                <textarea id="editQuizInstructions" rows="4">${item.instructions || ''}</textarea>
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
                const existingQuiz = sub.quizzes[itemIndex];
                sub.quizzes[itemIndex] = {
                    id: existingQuiz?.id || Date.now().toString(),
                    title: document.getElementById('editQuizTitle').value.trim(),
                    dueDate: document.getElementById('editQuizDueDate').value,
                    points: parseInt(document.getElementById('editQuizPoints').value),
                    status: existingQuiz?.status || 'available',
                    instructions: document.getElementById('editQuizInstructions').value.trim(),
                    quizLink: document.getElementById('editQuizLink').value.trim(),
                    submissions: existingQuiz?.submissions || []
                };
                saveSubjects(false); // false to prevent immediate Firestore sync that causes flicker
                renderSubjectDetails(subjectIndex);
                switchTab('quizzes');
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
    const openSubmitAssignmentModal = function(subjectIndex, assignmentIndex) {
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const assignment = sub.assignments[assignmentIndex];
        if (!assignment) return;

        // Ensure only one submit-assignment modal exists to avoid duplicate IDs and stale file inputs.
        const existingModal = document.getElementById('submitAssignmentModal');
        if (existingModal) {
            existingModal.remove();
        }

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
                            <input type="file" id="submitAssignmentFile" required />
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
            const fileInput = modal.querySelector('#submitAssignmentFile');
            if (!fileInput || !fileInput.files || !fileInput.files[0]) {
                alert('Please select a file to submit.');
                return;
            }

            const file = fileInput.files[0];
            console.log('Uploading file:', file.name);
            const courseId = normalizeCourseId(userData?.course);
            const uploadPrefix = buildStoragePrefix({
                courseId,
                subjectId: sub.id,
                itemType: "assignments",
                itemId: assignment.id,
                userId: userData.id
            });
            const fileUrl = await uploadFileToSupabase(file, uploadPrefix);
            console.log('Upload result:', fileUrl);

            if (!fileUrl) {
                alert('File upload failed. Please try again.');
                return;
            }

            try {
                await saveStudentSubmissionToFirestore({
                    type: "assignment",
                    subject: sub,
                    item: assignment,
                    fileName: file.name,
                    fileUrl
                });
            } catch (error) {
                console.error("Could not write assignment submission to Firestore:", error);
                alert(`Submission failed: ${error.message || "Could not save to Firestore."}`);
                return;
            }

            // Check if student already has a submission and update it, or add new one
            const currentUserId = auth.currentUser?.uid || userData.id;
            const existingIndex = assignment.submissions.findIndex(
                s => (s.studentId || s.id) === currentUserId
            );
            
            if (existingIndex >= 0) {
                // Update existing submission
                assignment.submissions[existingIndex] = {
                    studentId: currentUserId,
                    fileName: file.name,
                    fileUrl: fileUrl,
                    submittedAt: new Date().toISOString()
                };
            } else {
                // Add new submission
                assignment.submissions.push({
                    studentId: currentUserId,
                    fileName: file.name,
                    fileUrl: fileUrl,
                    submittedAt: new Date().toISOString()
                });
            }

            saveSubjects(false);
            renderSubjectDetails(subjectIndex);
            alert('Assignment submitted successfully!');
            modal.remove();
        });
    }

    // -------------------------
    // OPEN SUBMIT QUIZ MODAL
    // -------------------------
    const openSubmitQuizModal = function(subjectIndex, quizIndex) {
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const quiz = sub.quizzes[quizIndex];
        if (!quiz) return;

        // Ensure only one submit-quiz modal exists to avoid duplicate IDs and stale file inputs.
        const existingModal = document.getElementById('submitQuizModal');
        if (existingModal) {
            existingModal.remove();
        }

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'submitQuizModal';
        modal.innerHTML = `
            <div class="modal-content">
                <span class="close">&times;</span>
                <div class="modal-body">
                    <h2>Mark as Done: ${quiz.title}</h2>
                    <form id="submitQuizForm">
                        <input type="hidden" id="submitQuizSubjectIndex" value="${subjectIndex}" />
                        <input type="hidden" id="submitQuizIndex" value="${quizIndex}" />
                        <p style="margin-bottom: 20px;">Click the button below to mark this quiz as completed.</p>
                        <button type="submit" class="btn-add-subject">Mark as Done</button>
                    </form>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'block';

        modal.querySelector('.close').addEventListener('click', () => modal.remove());

        modal.querySelector('#submitQuizForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // Mark quiz as done without file upload
            const currentUserId = auth.currentUser?.uid || userData.id;
            const courseId = normalizeCourseId(userData?.course);

            try {
                await saveStudentSubmissionToFirestore({
                    type: "quiz",
                    subject: sub,
                    item: quiz,
                    fileName: "Quiz Completed",
                    fileUrl: null
                });
            } catch (error) {
                console.error("Could not write quiz submission to Firestore:", error);
                alert(`Submission failed: ${error.message || "Could not save to Firestore."}`);
                return;
            }

            // Check if student already has a submission and update it, or add new one
            const existingIndex = quiz.submissions.findIndex(
                s => (s.studentId || s.id) === currentUserId
            );
            
            if (existingIndex >= 0) {
                // Update existing submission
                quiz.submissions[existingIndex] = {
                    studentId: currentUserId,
                    fileName: "Quiz Completed",
                    fileUrl: null,
                    submittedAt: new Date().toISOString()
                };
            } else {
                // Add new submission
                quiz.submissions.push({
                    studentId: currentUserId,
                    fileName: "Quiz Completed",
                    fileUrl: null,
                    submittedAt: new Date().toISOString()
                });
            }

            saveSubjects(false);
            renderSubjectDetails(subjectIndex);
            alert('Quiz submitted successfully!');
            modal.remove();
        });
    }



    // -------------------------
    // VIEW QUIZ SUBMISSIONS
    // -------------------------
    const viewQuizSubmissions = async function(subjectIndex, quizIndex) {
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const quiz = sub.quizzes[quizIndex];
        if (!quiz) return;

        let submissions = Array.isArray(quiz.submissions) ? quiz.submissions : [];

        if (!submissions.length) {
            alert("No submissions yet.");
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'viewQuizSubmissionsModal';
        modal.innerHTML = `
            <div class="modal-content">
                <span class="close">&times;</span>
                <div class="modal-body">
                    <h2>Submissions for: ${quiz.title}</h2>
                    <div class="submissions-list">
                        ${submissions.map(submission => `
                            <div class="submission-item">
                                <p><strong>Student ID:</strong> ${submission.studentId || submission.id}</p>
                                <p><strong>Name:</strong> ${submission.studentName || "N/A"}</p>
                                <p><strong>File:</strong> <a href="${submission.fileUrl}" target="_blank">${submission.fileName}</a></p>
                                <p><strong>Submitted At:</strong> ${submission.submittedAt?.toDate ? submission.submittedAt.toDate().toLocaleString() : new Date(submission.submittedAt).toLocaleString()}</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'block';

        modal.querySelector('.close').addEventListener('click', () => modal.remove());
    };


    // -------------------------
    // OPEN SUBMIT TASK MODAL (STUDENT)
    // -------------------------
    const openSubmitTaskModal = function(subjectIndex, taskIndex) {
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const task = sub.tasks[taskIndex];
        if (!task) return;

        // Ensure only one submit-task modal exists to avoid duplicate IDs and stale file inputs.
        const existingModal = document.getElementById('submitTaskModal');
        if (existingModal) {
            existingModal.remove();
        }

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'submitTaskModal';
        modal.innerHTML = `
            <div class="modal-content">
                <span class="close">&times;</span>
                <div class="modal-body">
                    <h2>Submit Task: ${task.title}</h2>
                    <form id="submitTaskForm">
                        <input type="hidden" id="submitTaskSubjectIndex" value="${subjectIndex}" />
                        <input type="hidden" id="submitTaskIndex" value="${taskIndex}" />
                        <div class="form-group">
                            <label>Upload Your Submission</label>
                            <input type="file" id="submitTaskFile" required />
                        </div>
                        <button type="submit" class="btn-add-subject">Submit Task</button>
                    </form>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'block';

        modal.querySelector('.close').addEventListener('click', () => modal.remove());

        modal.querySelector('#submitTaskForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fileInput = modal.querySelector('#submitTaskFile');
            if (!fileInput || !fileInput.files || !fileInput.files[0]) {
                alert('Please select a file to submit.');
                return;
            }

            const file = fileInput.files[0];
            console.log('Uploading task submission:', file.name);
            const courseId = normalizeCourseId(userData?.course);
            const uploadPrefix = buildStoragePrefix({
                courseId,
                subjectId: sub.id,
                itemType: "tasks",
                itemId: task.id,
                userId: userData.id
            });
            const fileUrl = await uploadFileToSupabase(file, uploadPrefix);
            console.log('Upload result:', fileUrl);

            if (!fileUrl) {
                alert('File upload failed. Please try again.');
                return;
            }

            try {
                await saveStudentSubmissionToFirestore({
                    type: "task",
                    subject: sub,
                    item: task,
                    fileName: file.name,
                    fileUrl
                });
            } catch (error) {
                console.error("Could not write task submission to Firestore:", error);
                alert(`Submission failed: ${error.message || "Could not save to Firestore."}`);
                return;
            }

            // Check if student already has a submission and update it, or add new one
            const currentUserId = auth.currentUser?.uid || userData.id;
            const existingIndex = task.submissions.findIndex(
                s => (s.studentId || s.id) === currentUserId
            );
            
            if (existingIndex >= 0) {
                // Update existing submission
                task.submissions[existingIndex] = {
                    studentId: currentUserId,
                    fileName: file.name,
                    fileUrl: fileUrl,
                    submittedAt: new Date().toISOString()
                };
            } else {
                // Add new submission
                task.submissions.push({
                    studentId: currentUserId,
                    fileName: file.name,
                    fileUrl: fileUrl,
                    submittedAt: new Date().toISOString()
                });
            }

            // Update task status
            task.status = 'submitted';

            saveSubjects(false);
            renderSubjectDetails(subjectIndex);
            alert('Task submitted successfully!');
            modal.remove();
        });
    }

    // -------------------------
    // VIEW TASK SUBMISSIONS (INSTRUCTOR)
    // -------------------------
    const viewTaskSubmissions = async function(subjectIndex, taskIndex) {
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const task = sub.tasks[taskIndex];
        if (!task) return;

        let submissions = Array.isArray(task.submissions) ? task.submissions : [];

        if (!submissions.length) {
            alert("No submissions yet.");
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'viewTaskSubmissionsModal';
        modal.innerHTML = `
            <div class="modal-content">
                <span class="close">&times;</span>
                <div class="modal-body">
                    <h2>Submissions for: ${task.title}</h2>
                    <div class="submissions-list">
                        ${submissions.map(submission => `
                            <div class="submission-item">
                                <p><strong>Student ID:</strong> ${submission.studentId || submission.id}</p>
                                <p><strong>Name:</strong> ${submission.studentName || "N/A"}</p>
                                <p><strong>File:</strong> <a href="${submission.fileUrl}" target="_blank">${submission.fileName}</a></p>
                                <p><strong>Submitted At:</strong> ${submission.submittedAt?.toDate ? submission.submittedAt.toDate().toLocaleString() : new Date(submission.submittedAt).toLocaleString()}</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'block';

        modal.querySelector('.close').addEventListener('click', () => modal.remove());
    };

    // legacy static submitTaskForm handler removed; dynamic modal handler is used.

    // -------------------------
    // VIEW SUBMISSIONS
    // -------------------------
    const viewSubmissions = async function(subjectIndex, assignmentIndex) {
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const assignment = sub.assignments[assignmentIndex];
        if (!assignment) return;

        let submissions = Array.isArray(assignment.submissions) ? assignment.submissions : [];
        if (isInstructorRole && assignment.id) {
            try {
                submissions = await fetchItemSubmissionsFromFirestore("assignment", assignment.id);
                assignment.submissions = submissions;
                saveSubjects(false);
                renderSubjectDetails(subjectIndex);
            } catch (error) {
                console.warn("Could not load assignment submissions from Firestore:", error.message);
            }
        }

        if (!submissions.length) {
            alert("No submissions yet.");
            return;
        }

        // Get max points - ALWAYS use assignment points, not submission maxPoints
        // This fixes the bug where previous submissions had different maxPoints
        const maxPoints = assignment?.points || 100;
        
        const modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = 'viewSubmissionsModal';
            modal.innerHTML = `
                <div class="modal-content large-modal">
                    <span class="close">&times;</span>
                    <div class="modal-body">
                        <h2>Submissions for: ${assignment.title}</h2>
                        <p class="assignment-info">Due: ${assignment.dueDate} | Total Points: ${maxPoints}</p>
                        <div class="submissions-list">
                            ${submissions.map((submission, idx) => `
                                <div class="submission-item">
                                    <div class="submission-header">
                                        <h3>${submission.studentName || "Unknown Student"}</h3>
                                        <span class="submission-date">
                                            Submitted: ${submission.submittedAt?.toDate ? submission.submittedAt.toDate().toLocaleString() : new Date(submission.submittedAt).toLocaleString()}
                                        </span>
                                    </div>
                                    
                                    <div class="submission-file">
                                        <i class="fas fa-file"></i>
                                        <a href="${submission.fileUrl}" target="_blank">${submission.fileName}</a>
                                    </div>
                                    
                                    ${isInstructorRole ? `
                                        <div class="grading-section">
                                            <div class="grade-input-group">
                                                <label>Grade:</label>
                                                <input
                                                    type="number"
                                                    class="grade-input"
                                                    id="grade-${submission.studentId || submission.id}"
                                                    value="${submission.grade !== undefined ? submission.grade : ''}"
                                                    min="0"
                                                    max="${maxPoints}"
                                                    placeholder="0"
                                                /> / ${maxPoints} points
                                            </div>
                                        
                                        <div class="feedback-input-group">
                                            <label>Feedback:</label>
                                            <textarea
                                                class="feedback-input"
                                                id="feedback-${submission.studentId || submission.id}"
                                                rows="3"
                                                placeholder="Enter feedback for student..."
                                            >${submission.feedback || ''}</textarea>
                                        </div>
                                        
                                        <div class="grade-actions">
                                            <button
                                                type="button"
                                                class="btn-save-grade"
                                                onclick="event.preventDefault(); window.saveGrade(${subjectIndex}, ${assignmentIndex}, '${submission.studentId || submission.id}')">
                                                <i class="fas fa-save"></i> Save Grade
                                            </button>
                                            ${submission.status === 'graded' ? `
                                                <span class="graded-badge">
                                                    <i class="fas fa-check-circle"></i> Graded
                                                </span>
                                            ` : ''}
                                        </div>
                                    </div>
                                ` : `
                                    ${submission.grade !== undefined ? `
                                        <div class="student-grade-view">
                                            <p><strong>Grade:</strong> ${submission.grade} / ${assignment.points}</p>
                                            ${submission.feedback ? `
                                                <p><strong>Feedback:</strong> ${submission.feedback}</p>
                                            ` : ''}
                                        </div>
                                    ` : '<p class="pending-grade">Pending grading</p>'}
                                `}
                            </div>
                            ${idx < submissions.length - 1 ? '<hr class="submission-divider">' : ''}
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'block';

        modal.querySelector('.close').addEventListener('click', () => modal.remove());
    };

    // -------------------------
    // DELETE ITEM
    // -------------------------
    const deleteItem = async function(subjectIndex, type, itemIndex) {
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const arrayName = type === 'quiz' ? 'quizzes' : `${type}s`;
        if (!sub[arrayName] || !sub[arrayName][itemIndex]) return;

        const item = sub[arrayName][itemIndex];
        const itemId = item?.id;
        
        // Get course ID for Firestore operations
        const courseId = normalizeCourseId(userData?.course);
        
        if (confirm(`Are you sure you want to delete this ${type}?`)) {
            // Delete from Firestore if item has an ID
            if (itemId && courseId) {
                try {
                    const collectionName = type === 'quiz' ? 'quizzes' : type === 'task' ? 'tasks' : 'assignments';
                    const itemRef = doc(db, 'subjects', courseId, collectionName, itemId);
                    await deleteDoc(itemRef);
                    console.log(`${type} deleted from Firestore:`, itemId);
                } catch (error) {
                    console.error(`Error deleting ${type} from Firestore:`, error);
                    // Continue with local deletion even if Firestore deletion fails
                }
            }
            
            // Delete from local array
            sub[arrayName].splice(itemIndex, 1);
            saveSubjects();
            renderSubjectDetails(subjectIndex);
        }
    };

    // Expose handlers for inline onclick in Subjects page.
    window.subjectsOpenAddSubjectModal = () => {
        if (addModal) addModal.style.display = 'block';
    };
    window.subjectsCloseAllModals = closeAllModals;
    window.subjectsOpenEditModal = (index) => openEditModal(parseInt(index));
    window.subjectsOpenAddItemModal = (subjectIndex, type) => openAddItemModal(parseInt(subjectIndex), type);
    window.subjectsOpenEditItemModal = (subjectIndex, type, itemIndex) => openEditItemModal(parseInt(subjectIndex), type, parseInt(itemIndex));
    window.subjectsDeleteItem = (subjectIndex, type, itemIndex) => deleteItem(parseInt(subjectIndex), type, parseInt(itemIndex));
    window.subjectsOpenSubmitAssignmentModal = (subjectIndex, assignmentIndex) => openSubmitAssignmentModal(parseInt(subjectIndex), parseInt(assignmentIndex));
    window.subjectsOpenSubmitTaskModal = (subjectIndex, taskIndex) => openSubmitTaskModal(parseInt(subjectIndex), parseInt(taskIndex));
    window.subjectsOpenSubmitQuizModal = (subjectIndex, quizIndex) => openSubmitQuizModal(parseInt(subjectIndex), parseInt(quizIndex));
    window.subjectsOpenGradesForItem = (subjectIndex, itemType, itemId) => {
        const params = new URLSearchParams();
        params.set('subject', String(parseInt(subjectIndex)));
        params.set('type', String(itemType || '').toLowerCase());
        if (itemId) params.set('itemId', String(itemId));
        window.location.href = `Submissions.html?${params.toString()}`;
    };
    // Backward-compatible handlers for older inline onclick usages.
    window.subjectsViewSubmissions = (subjectIndex, assignmentIndex) => {
        const assignment = subjects?.[parseInt(subjectIndex)]?.assignments?.[parseInt(assignmentIndex)];
        window.subjectsOpenGradesForItem(parseInt(subjectIndex), 'assignment', assignment?.id || '');
    };
    window.subjectsViewTaskSubmissions = (subjectIndex, taskIndex) => {
        const task = subjects?.[parseInt(subjectIndex)]?.tasks?.[parseInt(taskIndex)];
        window.subjectsOpenGradesForItem(parseInt(subjectIndex), 'task', task?.id || '');
    };
    window.subjectsViewQuizSubmissions = (subjectIndex, quizIndex) => {
        const quiz = subjects?.[parseInt(subjectIndex)]?.quizzes?.[parseInt(quizIndex)];
        window.subjectsOpenGradesForItem(parseInt(subjectIndex), 'quiz', quiz?.id || '');
    };
    window.subjectsSwitchTab = (tab) => switchTab(tab);
    window.subjectsSyncToCloud = () => {
        saveSubjects(false);
        saveSubjectsToFirestore();
    };

    // -------------------------
    // SAVE TO LOCALSTORAGE
    // -------------------------
    const saveSubjects = function(autoSync = true) {
        localStorage.setItem('subjects', JSON.stringify(subjects));
        debugLog('Saving subjects to localStorage:', subjects);
        
        // Get userData from localStorage
        const currentUserData = JSON.parse(localStorage.getItem("userData"));
        const canSync = canSyncCourseData(currentUserData);
        
        // Auto-sync to Firestore for instructor users only
        if (autoSync && canSync && !disableSubjectsRealtime) {
            debugLog('Scheduling Firestore sync for course:', currentUserData.course);
            scheduleSubjectsSync();
        } else {
            debugLog('Not syncing to Firestore: autoSync=', autoSync, 'canSync=', canSync, 'userData.course=', currentUserData?.course, 'localMode=', disableSubjectsRealtime);
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
        const displayDate = isNaN(dateObj.getTime()) ? newData.dob : dateObj.toLocaleDateString('en-US', options);
        
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
        const fullName = document.getElementById('fullName');
        const fullNameDisplay = document.getElementById('fullNameDisplay');
        if (fullName) fullName.textContent = data.fullName;
        if (fullNameDisplay) fullNameDisplay.textContent = data.fullName;
    }
    if(data.email) {
        const infoEmail = document.getElementById('infoEmail');
        if (infoEmail) infoEmail.textContent = data.email;
    }
    if(data.phone) {
        const infoPhone = document.getElementById('infoPhone');
        if (infoPhone) infoPhone.textContent = data.phone;
    }
    if(data.dob) {
        const infoDOB = document.getElementById('infoDOB');
        if (infoDOB) infoDOB.textContent = data.dob;
    }
    if(data.gender) {
        const infoGender = document.getElementById('infoGender');
        if (infoGender) infoGender.textContent = data.gender;
    }

    const headerUserName = document.getElementById('headerUserName');
    if (headerUserName && data.fullName) headerUserName.textContent = data.fullName;
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

            const { term } = button.dataset;

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
// SAVE GRADE FUNCTIONALITY
// =========================
window.saveGrade = async function(subjectIndex, assignmentIndex, studentId) {
    debugLog('saveGrade called:', { subjectIndex, assignmentIndex, studentId });
    debugLog('subjects array:', subjects);
    
    const sub = subjects[subjectIndex];
    if (!sub) {
        alert('Error: Subject not found');
        return;
    }
    
    debugLog('Subject:', sub.name);
    debugLog('Assignments:', sub.assignments);
    
    const assignment = sub.assignments[assignmentIndex];
    if (!assignment) {
        alert('Error: Assignment not found');
        return;
    }
    
    debugLog('Assignment:', assignment);
    
    const userData = JSON.parse(localStorage.getItem("userData"));
    const courseId = normalizeCourseId(userData?.course);
    
    // Get grade and feedback from inputs
    const gradeInput = document.getElementById(`grade-${studentId}`);
    const feedbackInput = document.getElementById(`feedback-${studentId}`);
    
    debugLog('Looking for grade input with ID: grade-' + studentId);
    debugLog('Grade input element:', gradeInput);
    debugLog('Grade input value property BEFORE:', gradeInput?.value);
    
    if (!gradeInput) {
        alert('Error: Grade input field not found for student. Please refresh the page and try again.');
        return;
    }
    if (!feedbackInput) {
        alert('Error: Feedback input field not found');
        return;
    }
    
    // Get the raw value directly from the input element
    const gradeValue = gradeInput.value;
    const feedbackValue = feedbackInput.value;
    
    debugLog('Grade value from input:', gradeValue);
    debugLog('Grade input value AFTER read:', gradeInput.value);
    
    const grade = parseFloat(gradeValue);
    const feedback = feedbackValue;
    
    // Get max points - PRIORITIZE assignment points, not submission maxPoints
    let maxPoints = assignment?.points || 100;
    
    // Validate grade - check if it's a valid number
    debugLog('gradeValue is:', JSON.stringify(gradeValue), 'length:', gradeValue.length);
    if (gradeValue === '') {
        alert('Please enter a grade - the input field is empty! Check console for debug info.');
        return;
    }
    
    if (isNaN(grade)) {
        alert('Please enter a valid number for the grade');
        return;
    }
    
    if (grade < 0) {
        alert('Grade cannot be negative');
        return;
    }
    
    // Allow grading even if grade exceeds maxPoints (just warn but allow)
    if (grade > maxPoints) {
        const confirmExceed = confirm(`Warning: The grade (${grade}) exceeds the max points (${maxPoints}). Do you want to save anyway?`);
        if (!confirmExceed) return;
    }
    
    try {
        // Save to Firestore
        const submissionRef = doc(db, "subjects", courseId, "assignments", assignment.id, "submissions", studentId);
        await setDoc(submissionRef, {
            grade: grade,
            maxPoints: maxPoints,
            feedback: feedback,
            gradedAt: serverTimestamp(),
            gradedBy: auth.currentUser.uid,
            status: "graded"
        }, { merge: true });
        
        // Create notification for student
        try {
            const notificationRef = doc(collection(db, "notifications", studentId, "items"));
            await setDoc(notificationRef, {
                type: "grade_received",
                title: `Grade Posted: ${assignment.title}`,
                message: `You received ${grade}/${maxPoints} points`,
                link: `/Subjects.html?subject=${subjectIndex}&tab=assignments`,
                read: false,
                timestamp: serverTimestamp()
            });
        } catch (notifError) {
            console.warn("Could not create notification:", notifError.message);
        }
        
        alert('Grade saved successfully!');
        
        // Refresh the modal
        document.getElementById('viewSubmissionsModal').remove();
        viewSubmissions(subjectIndex, assignmentIndex);
        
    } catch (error) {
        console.error("Error saving grade:", error);
        alert("Failed to save grade: " + error.message);
    }
};

// =========================
// MENU FILTER FUNCTIONALITY
// =========================
function initializeMenuFilter() {
    const filterButtons = document.querySelectorAll('.filter-btn');
    const menuItems = document.querySelectorAll('.subject-card');

    if (!filterButtons.length || !menuItems.length) return;

    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons
            filterButtons.forEach(btn => btn.classList.remove('active'));
            // Add active class to clicked button
            button.classList.add('active');

            const { cuisine } = button.dataset;

            // Show/hide menu items based on cuisine
            menuItems.forEach(item => {
                if (cuisine === 'all' || item.classList.contains(cuisine)) {
                    item.classList.remove('hide');
                } else {
                    item.classList.add('hide');
                }
            });
        });
    });
}



// =========================
// AUTH GUARD - Protect pages from unauthenticated users
// =========================
function checkAuth() {
    const isLoginPage = window.location.pathname.includes('Login.html') || 
                        window.location.pathname.includes('SignUp.html') ||
                        window.location.pathname.endsWith('/');
    
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const userData = localStorage.getItem('userData');
    
    // If not on login/signup page and not logged in, redirect to login
    if (!isLoginPage && !isLoggedIn) {
        console.log('User not authenticated, redirecting to login...');
        window.location.href = 'Login.html';
        return false;
    }
    
    // If on login/signup page and already logged in, redirect to dashboard
    if (isLoginPage && isLoggedIn && userData) {
        console.log('User already logged in, redirecting to dashboard...');
        window.location.href = 'index.html';
        return false;
    }
    
    return true;
}

function ensureSharedDomScaffold() {
    const path = window.location.pathname.toLowerCase();
    const isSubjectsPage = path.includes('subjects.html');
    if (isSubjectsPage) return;

    if (document.getElementById('sharedDomScaffold')) return;

    const scaffold = document.createElement('div');
    scaffold.id = 'sharedDomScaffold';
    scaffold.style.display = 'none';
    scaffold.setAttribute('aria-hidden', 'true');
    scaffold.innerHTML = `
        <div id="subjectsList"></div>
        <div id="subjectDetailsPanel"></div>
    `;

    document.body.appendChild(scaffold);
}

// =========================
// INITIALIZE EVERYTHING ON DOM
// =========================
document.addEventListener("DOMContentLoaded", () => {
    // Run auth check first
    if (!checkAuth()) return;

    // Keep required DOM hooks available on non-owner pages.
    ensureSharedDomScaffold();
    
    initializeTheme();
    initializeHeaderProfileMenu();
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
    initializeMenuFilter();

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

// Old initialization - commented out
/*
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
    initializeMenuFilter();

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
*/

// =========================
// EXPORT LOGOUT & THEME
// =========================
export { logout, applyTheme };

window.submitStudentFile = async function(subjectId, taskId, file) {
  const firebaseUser = auth.currentUser || await waitForAuthReady();
  const userData = JSON.parse(localStorage.getItem("userData") || "{}");
  const courseId = normalizeCourseId(userData?.course);

  if (!firebaseUser || !courseId) {
    alert("Please login first");
    return;
  }

  const userId = firebaseUser.uid;
  const safeSubjectId = subjectId || "unknown-subject";
  const path = buildStoragePath({
    courseId,
    subjectId: safeSubjectId,
    itemType: "tasks",
    itemId: taskId,
    userId,
    fileName: file.name
  });

  try {

    const { error } = await supabase
      .storage
      .from("files")
      .upload(path, file, { upsert: true });

    if (error) throw error;

    const fileUrl = supabase.storage.from('files').getPublicUrl(path).data.publicUrl;

    await saveStudentSubmissionToFirestore({
      type: "task",
      subject: { id: safeSubjectId, name: "" },
      item: { id: taskId, title: "" },
      fileName: file.name,
      fileUrl
    });

    alert("Submission successful!");

  } catch (err) {
    console.error(err);
    alert("Upload failed: " + err.message);
  }
};
