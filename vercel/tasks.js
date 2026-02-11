// tasks.js - CRUD operations for tasks with role-based access and file uploads

import { db, auth } from './firebase.js';
import { supabase } from './supabase.js';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, addDoc, collection, serverTimestamp, arrayUnion } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Helper function to get current user role
function getCurrentUserRole() {
    const userData = JSON.parse(localStorage.getItem('userData'));
    return userData ? userData.role : null;
}

// Helper function to get current user ID
function getCurrentUserId() {
    const user = auth.currentUser;
    return user ? user.uid : null;
}

// Upload file to Supabase (similar to existing function)
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

// Create a new task (Instructor only)
export async function createTask(subjectId, taskData) {
    const role = getCurrentUserRole();
    if (role !== 'instructor') {
        throw new Error('Only instructors can create tasks');
    }

    const userId = getCurrentUserId();
    if (!userId) {
        throw new Error('User not authenticated');
    }

    try {
        let fileUrl = null;
        if (taskData.file) {
            const path = `subjects/${subjectId}/tasks/`;
            fileUrl = await uploadFileToSupabase(taskData.file, path);
        }

        const taskRef = collection(db, 'subjects', subjectId, 'tasks');
        const newTask = {
            title: taskData.title,
            description: taskData.description || '',
            dueDate: taskData.dueDate,
            priority: taskData.priority || 'medium',
            status: 'pending',
            createdBy: userId,
            createdAt: serverTimestamp(),
            fileName: taskData.file ? taskData.file.name : null,
            fileUrl: fileUrl,
            submissions: [] // Array of submissions
        };

        const docRef = await addDoc(taskRef, newTask);
        console.log('Task created:', docRef.id);
        return docRef.id;
    } catch (error) {
        console.error('Error creating task:', error);
        throw error;
    }
}

// Update an existing task (Instructor only)
export async function updateTask(subjectId, taskId, taskData) {
    const role = getCurrentUserRole();
    if (role !== 'instructor') {
        throw new Error('Only instructors can update tasks');
    }

    try {
        let fileUrl = taskData.fileUrl; // Keep existing if no new file
        if (taskData.file) {
            const path = `subjects/${subjectId}/tasks/`;
            fileUrl = await uploadFileToSupabase(taskData.file, path);
        }

        const taskRef = doc(db, 'subjects', subjectId, 'tasks', taskId);
        await updateDoc(taskRef, {
            title: taskData.title,
            description: taskData.description || '',
            dueDate: taskData.dueDate,
            priority: taskData.priority || 'medium',
            status: taskData.status || 'pending',
            fileName: taskData.file ? taskData.file.name : taskData.fileName,
            fileUrl: fileUrl,
            updatedAt: serverTimestamp()
        });
        console.log('Task updated:', taskId);
    } catch (error) {
        console.error('Error updating task:', error);
        throw error;
    }
}

// Delete a task (Instructor only)
export async function deleteTask(subjectId, taskId) {
    const role = getCurrentUserRole();
    if (role !== 'instructor') {
        throw new Error('Only instructors can delete tasks');
    }

    try {
        const taskRef = doc(db, 'subjects', subjectId, 'tasks', taskId);
        await deleteDoc(taskRef);
        console.log('Task deleted:', taskId);
    } catch (error) {
        console.error('Error deleting task:', error);
        throw error;
    }
}

// Submit a file for a task (Students only)
export async function submitTaskSubmission(subjectId, taskId, file) {
    const role = getCurrentUserRole();
    if (role !== 'student') {
        throw new Error('Only students can submit task files');
    }

    const userId = getCurrentUserId();
    if (!userId) {
        throw new Error('User not authenticated');
    }

    try {
        const path = `subjects/${subjectId}/tasks/${taskId}/submissions/${userId}/`;
        const fileUrl = await uploadFileToSupabase(file, path);

        const taskRef = doc(db, 'subjects', subjectId, 'tasks', taskId);
        await updateDoc(taskRef, {
            submissions: arrayUnion({
                studentId: userId,
                fileName: file.name,
                fileUrl: fileUrl,
                submittedAt: serverTimestamp()
            })
        });
        console.log('Submission added to task:', taskId);
    } catch (error) {
        console.error('Error submitting task:', error);
        throw error;
    }
}

// Get a single task (for viewing)
export async function getTask(subjectId, taskId) {
    try {
        const taskRef = doc(db, 'subjects', subjectId, 'tasks', taskId);
        const taskSnap = await getDoc(taskRef);
        if (taskSnap.exists()) {
            return { id: taskSnap.id, ...taskSnap.data() };
        } else {
            throw new Error('Task not found');
        }
    } catch (error) {
        console.error('Error getting task:', error);
        throw error;
    }
}

// Get all tasks for a subject (though realtime handles this, for initial load)
export async function getTasks(subjectId) {
    // This can be used if needed, but realtime.js handles ongoing updates
    // Implementation would use getDocs from collection
    // For now, rely on realtime
    console.warn('Use realtime listeners for tasks. getTasks is for fallback.');
}
