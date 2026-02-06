// =========================
// IMPORT FIREBASE AUTH
// =========================
import { auth } from './firebase.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

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

    if (!listContainer || !detailsContainer) return;

    // Dummy data for demonstration
    let subjects = [
        { name: "Mathematics", teacher: "Mr. Anderson", time: "08:00 AM - 09:30 AM", description: "Advanced Calculus and Algebra" },
        { name: "Physics", teacher: "Ms. Curie", time: "10:00 AM - 11:30 AM", description: "Fundamentals of Physics" },
        { name: "Computer Science", teacher: "Mr. Turing", time: "01:00 PM - 02:30 PM", description: "Algorithms and Data Structures" }
    ];

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
            </div>

            <div class="lessons-container">
                <h3><i class="fas fa-list-ul"></i> Lessons</h3>
                ${dummyLessons.map(lesson => `
                    <div class="lesson-item">
                        <div class="lesson-info">
                            <h4>${lesson.title}</h4>
                            <p><i class="fas fa-clock"></i> ${lesson.duration} • ${lesson.status}</p>
                        </div>
                        <button class="btn-start-lesson">
                            ${lesson.status === 'Locked' ? '<i class="fas fa-lock"></i>' : '<i class="fas fa-play"></i> Start'}
                        </button>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // -------------------------
    // OPEN ADD MODAL
    // -------------------------
    addBtn?.addEventListener('click', () => {
        addModal.style.display = 'block';
    });

    // -------------------------
    // CLOSE MODALS
    // -------------------------
    document.querySelectorAll('.modal .close').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal').style.display = 'none';
        });
    });

    window.addEventListener('click', e => {
        if (e.target === addModal) addModal.style.display = 'none';
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
            description: document.getElementById('newSubjectDescription').value.trim()
        };

        subjects.push(subject);
        renderSubjects();

        addForm.reset();
        addModal.style.display = 'none';
    });

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
