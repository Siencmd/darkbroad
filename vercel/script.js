// =========================
// IMPORT FIREBASE AUTH & SUPABASE
// =========================
import { auth, db } from './firebase.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { supabase } from './supabase.js';
import { setupRealtimeSubjects, stopTaskListeners } from './realtime.js';

// Maximum subjects limit to prevent Firestore quota issues
const MAX_SUBJECTS_LIMIT = 10;

let subjectsRealtimeUnsubscribe = null;
let disableSubjectsRealtime = false;
let isSavingSubjects = false; // Flag to prevent realtime loop when saving
let syncTimer = null;
let lastSyncedSubjectsHash = null;

// db is now imported from firebase.js

function normalizeSubject(subject, index = 0) {
    const normalizeTask = (task) => ({
        ...task,
        file: task?.file || task?.fileName || null,
        fileUrl: task?.fileUrl || task?.url || null
    });

    return {
        id: subject?.id || `legacy-subject-${index}`,
        name: subject?.name || "Untitled Subject",
        teacher: subject?.teacher || "",
        time: subject?.time || "",
        description: subject?.description || "",
        tasks: Array.isArray(subject?.tasks) ? subject.tasks.map(normalizeTask) : [],
        assignments: Array.isArray(subject?.assignments) ? subject.assignments : [],
        lessons: Array.isArray(subject?.lessons) ? subject.lessons : [],
        quizzes: Array.isArray(subject?.quizzes) ? subject.quizzes : []
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

    const usersRef = doc(db, "users", uid);
    const usersSnap = await getDoc(usersRef);
    if (usersSnap.exists()) {
        return { source: "users", uid, ...usersSnap.data() };
    }

    const studentsRef = doc(db, "students", uid);
    const studentsSnap = await getDoc(studentsRef);
    if (studentsSnap.exists()) {
        return { source: "students", uid, ...studentsSnap.data() };
    }

    return { source: "none", uid };
}

const storedSubjects = normalizeSubjects(JSON.parse(localStorage.getItem('subjects')));
let subjects = storedSubjects.length ? storedSubjects : [
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

// Function to setup task listeners for all subjects
function setupTaskListeners() {
    // Tasks are currently stored in each subject document array on /subjects/{courseId}.
    // Listening to /subjects/{subjectId}/tasks causes permission errors for this schema.
    // Keep this as a no-op until the app fully migrates to per-subject task subcollections.
    return;
}



// Upload file to Supabase with enhanced error handling and logging
async function uploadFileToSupabase(file, path) {
    try {
        console.log('Starting upload to Supabase:', path + file.name);
        const { data, error } = await supabase.storage.from('files').upload(path + file.name, file, {
            upsert: true
        });
        if (error) {
            console.error('Supabase upload error:', error);
            throw new Error(`Upload failed: ${error.message}`);
        }
        console.log('Upload successful, getting public URL');
        const { data: urlData } = supabase.storage.from('files').getPublicUrl(path + file.name);
        if (!urlData || !urlData.publicUrl) {
            throw new Error('Failed to get public URL');
        }
        console.log('Public URL obtained:', urlData.publicUrl);
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
    if (!userData || !userData.id || !courseId) {
        throw new Error("Missing user session data for submission.");
    }

    const collectionName = type === "task" ? "tasks" : "assignments";
    const itemId = item.id || Date.now().toString();
    item.id = itemId;

    const itemRef = doc(db, "subjects", courseId, collectionName, itemId);
    const submissionRef = doc(db, "subjects", courseId, collectionName, itemId, "submissions", userData.id);

    // Ensure parent item doc exists for subcollection rules/reads.
    await setDoc(itemRef, {
        subjectId: subject.id || "",
        subjectName: subject.name || "",
        title: item.title || "",
        dueDate: item.dueDate || "",
        updatedAt: serverTimestamp()
    }, { merge: true });

    await setDoc(submissionRef, {
        studentId: userData.id,
        studentName: userData.name || "",
        fileName,
        fileUrl,
        submittedAt: serverTimestamp()
    }, { merge: true });
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
    console.log('initializeSubjects called');
    
    const listContainer = document.getElementById('subjectsList');
    const detailsContainer = document.getElementById('subjectDetailsPanel');
    const addBtn = document.getElementById('addSubjectBtn');
    const addModal = document.getElementById('addSubjectModal');
    const addForm = document.getElementById('addSubjectForm');
    const editModal = document.getElementById('editSubjectModal');
    const editForm = document.getElementById('editSubjectForm');
    const deleteBtn = document.getElementById('deleteSubjectBtn');

    console.log('Elements found:', {
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
        console.error('Missing required elements, exiting');
        return;
    }

    // Get user role
    let userData = JSON.parse(localStorage.getItem("userData"));
    const userRole = (userData?.role || 'student').toLowerCase();
    const isInstructorRole = userRole === 'instructor' || userRole === 'teacher' || userRole === 'admin';
    console.log('User role:', userRole);
    console.log('Add button element:', addBtn);

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

    // -------------------------
    // RENDER SUBJECTS - SIDEBAR
    // -------------------------
    const renderSubjects = function() {
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
        const courseId = normalizeCourseId(userData.course);
        let cloudInitialized = false;

        const initializeCloudSync = () => {
            if (cloudInitialized) return;
            cloudInitialized = true;

            loadSubjectsFromFirestore(courseId, renderSubjects).then(() => {
                // Enable realtime updates for all users in the course
                subjectsRealtimeUnsubscribe = setupRealtimeSubjects(courseId, (updatedSubjects) => {
                    // Skip if realtime is disabled or if we're currently saving (prevents loop)
                    if (disableSubjectsRealtime || isSavingSubjects) {
                        console.log("Skipping realtime update - disabled or saving");
                        return;
                    }

                    // When subjects update, stop existing task listeners and re-setup
                    stopTaskListeners();
                    subjects = updatedSubjects;
                    subjects = normalizeSubjects(subjects);
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
                    console.log("Realtime update: Subjects refreshed from cloud.");
                }, (error) => {
                    console.warn("Realtime connection failed, using local data only:", error.message);
                });
                // Setup task listeners after subjects are loaded
                setupTaskListeners();
            }).catch((error) => {
                console.warn("Cloud sync unavailable - using local data:", error.message);
                renderSubjects();
            });
        };

        const authUnsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            if (!firebaseUser) {
                return;
            }
            initializeCloudSync();
            // We only need this once for subjects initialization.
            authUnsubscribe();
        });

        // Fast path when auth is already available.
        if (auth.currentUser) {
            initializeCloudSync();
            authUnsubscribe();
        } else {
            // Fallback UI render while waiting for auth state.
            renderSubjects();
            console.log("Waiting for Firebase auth before attaching realtime subjects listener...");
        }
    } else {
        console.log("No user course data, using localStorage data only");
        renderSubjects();
    }

    // -------------------------
    // RENDER DETAILS
    // -------------------------
    const renderSubjectDetails = function(index) {
        const sub = subjects[index];
        if (!sub) return;

        const isInstructor = isInstructorRole;
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
                        ${sub.tasks.map((task, i) => `
                            <div class="item-card">
                                <div class="item-info">
                                    <h4>${task.title}</h4>
                                    <p>Due: ${task.dueDate} | Priority: ${task.priority} | Status: ${task.status}</p>
                                    <p>${task.description}</p>
                                    ${(task.file || task.fileName) ? `<p><i class="fas fa-paperclip"></i> <a href="${task.fileUrl || task.url || '#'}" target="_blank">${task.file || task.fileName}</a></p>` : ''}
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
                        `).join('')}
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
                        ${sub.assignments.map((assignment, i) => `
                            <div class="item-card">
                                <div class="item-info">
                                    <h4>${assignment.title}</h4>
                                    <p>Due: ${assignment.dueDate} | Points: ${assignment.points} | Status: ${assignment.status}</p>
                                    <p>${assignment.instructions}</p>
                                    ${assignment.file ? `<p><i class="fas fa-paperclip"></i> <a href="${assignment.fileUrl}" target="_blank">${assignment.file}</a></p>` : ''}
                                    ${isInstructor ? `
                                    <div class="instructor-actions">
                                        <button class="btn-view-submissions" data-assignment-index="${i}" data-subject-index="${index}" onclick="window.subjectsViewSubmissions(${index}, ${i})">
                                            <i class="fas fa-eye"></i> View Submissions (${assignment.submissions ? assignment.submissions.length : 0})
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
                        `).join('')}
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
                                    <button class="btn-edit-item" data-type="lesson" data-item-index="${i}" data-subject-index="${index}" onclick="window.subjectsOpenEditItemModal(${index}, 'lesson', ${i})">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn-delete-item" data-type="lesson" data-item-index="${i}" data-subject-index="${index}" onclick="window.subjectsDeleteItem(${index}, 'lesson', ${i})">
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
                        ${isInstructor ? `<button class="btn-add-item" data-type="quiz" data-subject-index="${index}" onclick="window.subjectsOpenAddItemModal(${index}, 'quiz')">
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
                                    <button class="btn-edit-item" data-type="quiz" data-item-index="${i}" data-subject-index="${index}" onclick="window.subjectsOpenEditItemModal(${index}, 'quiz', ${i})">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn-delete-item" data-type="quiz" data-item-index="${i}" data-subject-index="${index}" onclick="window.subjectsDeleteItem(${index}, 'quiz', ${i})">
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

        // Keep a default visible tab state after each render.
        switchTab('tasks');

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
    const closeAllModals = function() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
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
                form.reset();
                if (addModal) addModal.style.display = 'none';
                return;
            }

            if (form.id === 'editSubjectForm') {
                e.preventDefault();
                e.stopImmediatePropagation();

                const index = parseInt(document.getElementById('editSubjectIndex').value);
                if (Number.isNaN(index) || !subjects[index]) return;

                subjects[index] = {
                    ...subjects[index],
                    name: document.getElementById('editSubjectName').value.trim(),
                    teacher: document.getElementById('editTeacherName').value.trim(),
                    time: document.getElementById('editSubjectTime').value.trim(),
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

        const viewSubmissionsBtn = e.target.closest('.btn-view-submissions');
        if (viewSubmissionsBtn) {
            viewSubmissions(
                parseInt(viewSubmissionsBtn.dataset.subjectIndex),
                parseInt(viewSubmissionsBtn.dataset.assignmentIndex)
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





    // -------------------------
    // ADD SUBJECT (FORM)
    // -------------------------
    addForm?.addEventListener('submit', async e => {
        e.preventDefault();

        // Check if we've reached the maximum limit
        if (subjects.length >= MAX_SUBJECTS_LIMIT) {
            alert(`Cannot add more subjects. Maximum limit of ${MAX_SUBJECTS_LIMIT} subjects reached.`);
            return;
        }

        const subject = {
            id: Date.now().toString(), // Unique ID for subject
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

        // Setup task listener for the new subject
        setupTaskListeners();

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
            ...subjects[index],
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
    if (fileInput.files[0]) {
        const file = fileInput.files[0];
        const fileName = file.name;
        const fileUrl = await uploadFileToSupabase(file, `subjects/${sub.id}/${task.id}/`);
        task.file = fileName;
        task.fileUrl = fileUrl;
    }

        sub.tasks.push(task);
        saveSubjects();
        renderSubjectDetails(subjectIndex);

        // Switch to tasks tab
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector('.tab-btn[data-tab="tasks"]').classList.add('active');
        document.getElementById('tasks-tab').classList.add('active');

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

    // -------------------------
    // ADD ASSIGNMENT (FORM)
    // -------------------------
    const addAssignmentForm = document.getElementById('addAssignmentForm');
    addAssignmentForm?.addEventListener('submit', async e => {
        e.preventDefault();

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
        if (fileInput.files[0]) {
            const file = fileInput.files[0];
            const fileName = file.name;
            const fileUrl = await uploadFileToSupabase(file, `subjects/${sub.id}/${assignment.id}/`);
            assignment.file = fileName;
            assignment.fileUrl = fileUrl;
        }

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

    // -------------------------
    // ADD LESSON (FORM)
    // -------------------------
    const addLessonForm = document.getElementById('addLessonForm');
    addLessonForm?.addEventListener('submit', async e => {
        e.preventDefault();

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
        if (fileInput.files[0]) {
            const file = fileInput.files[0];
            const fileName = file.name;
            const fileUrl = await uploadFileToSupabase(file, `subjects/${sub.id}/${lesson.id}/`);
            lesson.file = fileName;
            lesson.fileUrl = fileUrl;
        }

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
    const openEditItemModal = function(subjectIndex, type, itemIndex) {
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const arrayName = type === 'quiz' ? 'quizzes' : `${type}s`;
        const item = sub[arrayName]?.[itemIndex];
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
            const fileUrl = await uploadFileToSupabase(file, `subjects/${sub.id}/${assignment.id}/submissions/${userData.id}/`);
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

            try {
                await saveStudentSubmissionToFirestore({
                    type: "assignment",
                    subject: sub,
                    item: assignment,
                    fileName: file.name,
                    fileUrl
                });
            } catch (error) {
                console.warn("Could not write assignment submission to Firestore:", error.message);
            }

            saveSubjects(false);
            renderSubjectDetails(subjectIndex);
            alert('Assignment submitted successfully!');
            modal.remove();
        });
    }



    // -------------------------
    // SUBMIT TASK FORM HANDLER
    // -------------------------
    const submitTaskForm = document.getElementById('submitTaskForm');
    if (submitTaskForm) {
        submitTaskForm.addEventListener('submit', async e => {
            e.preventDefault();
            
            const subjectIndex = parseInt(document.getElementById('submitTaskSubjectIndex').value);
            const taskIndex = parseInt(document.getElementById('submitTaskIndex').value);
            const sub = subjects[subjectIndex];
            if (!sub) return;

            const task = sub.tasks[taskIndex];
            if (!task) return;

            const userData = JSON.parse(localStorage.getItem('userData'));
            const fileInput = document.getElementById('submitTaskFile');
            if (!fileInput.files[0]) {
                alert('Please select a file to submit.');
                return;
            }

            const file = fileInput.files[0];
            console.log('Uploading task submission:', file.name);
            const fileUrl = await uploadFileToSupabase(file, `subjects/${sub.id}/${task.id}/submissions/${userData.id}/`);
            console.log('Upload result:', fileUrl);

            if (!fileUrl) {
                alert('File upload failed. Please try again.');
                return;
            }

            if (!task.submissions) task.submissions = [];
            task.submissions.push({
                studentId: userData.id,
                fileName: file.name,
                fileUrl: fileUrl,
                submittedAt: new Date().toISOString()
            });

            try {
                await saveStudentSubmissionToFirestore({
                    type: "task",
                    subject: sub,
                    item: task,
                    fileName: file.name,
                    fileUrl
                });
            } catch (error) {
                console.warn("Could not write task submission to Firestore:", error.message);
            }

            // Update task status
            task.status = 'submitted';

            saveSubjects(false);
            renderSubjectDetails(subjectIndex);
            alert('Task submitted successfully!');
            document.getElementById('submitTaskModal').style.display = 'none';
            submitTaskForm.reset();
        });
    }

    // -------------------------
    // VIEW SUBMISSIONS
    // -------------------------
    const viewSubmissions = function(subjectIndex, assignmentIndex) {
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
    };

    // -------------------------
    // DELETE ITEM
    // -------------------------
    const deleteItem = function(subjectIndex, type, itemIndex) {
        const sub = subjects[subjectIndex];
        if (!sub) return;

        const arrayName = type === 'quiz' ? 'quizzes' : `${type}s`;
        if (!sub[arrayName] || !sub[arrayName][itemIndex]) return;

        if (confirm(`Are you sure you want to delete this ${type}?`)) {
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
    window.subjectsViewSubmissions = (subjectIndex, assignmentIndex) => viewSubmissions(parseInt(subjectIndex), parseInt(assignmentIndex));
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
        console.log('Saving subjects to localStorage:', subjects);
        
        // Get userData from localStorage
        const currentUserData = JSON.parse(localStorage.getItem("userData"));
        const canSync = canSyncCourseData(currentUserData);
        
        // Auto-sync to Firestore for instructor users only
        if (autoSync && canSync && !disableSubjectsRealtime) {
            console.log('Scheduling Firestore sync for course:', currentUserData.course);
            scheduleSubjectsSync();
        } else {
            console.log('Not syncing to Firestore: autoSync=', autoSync, 'canSync=', canSync, 'userData.course=', currentUserData?.course, 'localMode=', disableSubjectsRealtime);
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
  const path = `subjects/${courseId}/${safeSubjectId}/${taskId}/submissions/${userId}/${file.name}`;

  try {

    const { error } = await supabase
      .storage
      .from("files")
      .upload(path, file, { upsert: true });

    if (error) throw error;

    const fileUrl = supabase.storage.from('files').getPublicUrl(path).data.publicUrl;

    const taskRef = doc(db, "subjects", courseId, "tasks", taskId);
    const submissionRef = doc(db, "subjects", courseId, "tasks", taskId, "submissions", userId);

    await setDoc(taskRef, {
      subjectId: safeSubjectId,
      updatedAt: serverTimestamp()
    }, { merge: true });

    await setDoc(submissionRef, {
      studentId: userId,
      fileName: file.name,
      fileUrl: fileUrl,
      submittedAt: serverTimestamp()
    }, { merge: true });

    alert("Submission successful!");

  } catch (err) {
    console.error(err);
    alert("Upload failed: " + err.message);
  }
};
