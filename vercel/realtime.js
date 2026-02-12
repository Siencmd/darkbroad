// realtime.js - Real-time Firestore listeners for subjects and tasks
// LIMIT: Maximum 10 subjects per course to prevent Firestore quota issues

import { db } from './firebase.js';
import { collection, doc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Maximum subjects limit to prevent Firestore quota issues
export const MAX_SUBJECTS_LIMIT = 10;

// Global variables to store listeners (for cleanup if needed)
let subjectsListener = null;
let tasksListeners = {}; // Map of subjectId to listener

// Function to setup real-time listeners for subjects
export function setupRealtimeSubjects(courseId, onSubjectsUpdate, onError) {
    if (!courseId) {
        console.error('Course ID required for real-time subjects');
        return;
    }

    console.log('Setting up realtime listener for course:', courseId);

    // Unsubscribe previous listener if exists
    if (subjectsListener) {
        console.log('Unsubscribing previous listener');
        subjectsListener();
    }

    // Use single document reference (same as old website)
    const docRef = doc(db, 'subjects', courseId);

    subjectsListener = onSnapshot(docRef, (docSnap) => {
        console.log('Snapshot received, exists:', docSnap.exists());
        if (docSnap.exists()) {
            const data = docSnap.data();
            let subjects = data.subjects || [];
            
            // Enforce limit of 10 subjects to prevent quota issues
            if (subjects.length > MAX_SUBJECTS_LIMIT) {
                console.warn(`Subjects count (${subjects.length}) exceeds limit of ${MAX_SUBJECTS_LIMIT}. Truncating...`);
                subjects = subjects.slice(0, MAX_SUBJECTS_LIMIT);
            }
            
            console.log('Real-time subjects update, count:', subjects.length);
            onSubjectsUpdate(subjects);
        } else {
            console.log('No subjects document found for course:', courseId);
            onSubjectsUpdate([]);
        }
    }, (error) => {
        console.error('Real-time subjects error:', error.code, error.message);
        if (onError) onError(error);
    });

    console.log('Realtime listener set up successfully');
    return subjectsListener;
}

// Function to setup real-time listeners for tasks in a specific course document
export function setupRealtimeTasks(courseId, onTasksUpdate, onError) {
    if (!courseId) {
        console.error('Course ID required for real-time tasks');
        return;
    }

    // Unsubscribe previous listener for this course if exists
    if (tasksListeners[courseId]) {
        tasksListeners[courseId]();
    }

    const tasksRef = collection(db, 'subjects', courseId, 'tasks');
    const q = query(tasksRef, orderBy('createdAt', 'desc'));

    tasksListeners[courseId] = onSnapshot(q, (snapshot) => {
        const tasks = [];
        snapshot.forEach((doc) => {
            tasks.push({ id: doc.id, ...doc.data() });
        });
        console.log(`Real-time tasks update for course ${courseId}:`, tasks);
        onTasksUpdate(courseId, tasks);
    }, (error) => {
        console.error(`Real-time tasks error for course ${courseId}:`, error);
        if (onError) onError(error);
    });

    return tasksListeners[courseId];
}

// Function to stop all real-time listeners
export function stopRealtimeListeners() {
    if (subjectsListener) {
        subjectsListener();
        subjectsListener = null;
    }

    Object.values(tasksListeners).forEach(unsubscribe => unsubscribe());
    tasksListeners = {};
}

// Function to stop only task listeners
export function stopTaskListeners() {
    Object.values(tasksListeners).forEach(unsubscribe => unsubscribe());
    tasksListeners = {};
}

// Function to handle UI updates when subjects change
export function handleSubjectsRealtimeUpdate(subjects) {
    // This function can be called to update the UI
    // Assuming there's a global function or way to update subjects list
    if (window.updateSubjectsUI) {
        window.updateSubjectsUI(subjects);
    } else {
        console.warn('updateSubjectsUI function not found. Please implement it in your main script.');
    }
}

// Function to handle UI updates when tasks change
export function handleTasksRealtimeUpdate(subjectId, tasks) {
    // This function can be called to update the UI for a specific subject
    if (window.updateTasksUI) {
        window.updateTasksUI(subjectId, tasks);
    } else {
        console.warn('updateTasksUI function not found. Please implement it in your main script.');
    }
}
