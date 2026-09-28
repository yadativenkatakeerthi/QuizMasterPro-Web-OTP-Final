// ============================================================
// QuizMaster Pro - Web Version
// Based on the original Java Swing project
// ============================================================

const STORAGE_KEYS = {
    users: "quizMasterPro_users",
    profiles: "quizMasterPro_profiles",
    history: "quizMasterPro_history"
};

let currentPlayer = null;
let currentQuiz = null;
let quizTimer = null;
let registeredCountUnsubscribe = null;

// ============================================================
// FIREBASE - SHARED REGISTERED USER COUNT
// Replace the values below with your Firebase Web App config.
// See SETUP.md for the exact steps.
// ============================================================
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

let firebaseReady = false;
let db = null;

// ============================================================
// SUPABASE - EMAIL OTP AUTHENTICATION
// Replace these two values with your Supabase project settings.
// See SETUP.md for the exact steps.
// ============================================================
const SUPABASE_URL = window.QMP_SUPABASE_CONFIG?.url || "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = window.QMP_SUPABASE_CONFIG?.anonKey || "YOUR_SUPABASE_ANON_KEY";

let supabaseReady = false;
let supabaseClient = null;

try {
    if (
        typeof supabase !== "undefined" &&
        SUPABASE_URL !== "YOUR_SUPABASE_URL" &&
        SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY"
    ) {
        supabaseClient = supabase.createClient(
            SUPABASE_URL,
            SUPABASE_ANON_KEY
        );
        supabaseReady = true;
    }
} catch (error) {
    console.error("Supabase initialization error:", error);
}

let authFlow = {
    mode: null,
    email: "",
    name: ""
};

try {
    if (typeof firebase !== "undefined" && firebaseConfig.apiKey !== "YOUR_API_KEY") {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        firebaseReady = true;
    }
} catch (error) {
    console.error("Firebase initialization error:", error);
}


// ============================================================
// STORAGE
// ============================================================

function loadData(key, defaultValue = []) {
    try {
        const data = localStorage.getItem(key);

        if (!data) {
            return defaultValue;
        }

        return JSON.parse(data);

    } catch (error) {
        console.error("Storage error:", error);
        return defaultValue;
    }
}

function saveData(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}


// ============================================================
// USER MANAGER
// ============================================================

async function registerUser(name, email, registrationId) {
    // Firebase stores one document per verified account so the shared
    // registered-user count remains synchronized across devices.
    if (!firebaseReady) {
        const users = loadData(STORAGE_KEYS.users);
        const normalizedEmail = (email || "").trim().toLowerCase();
        const exists = users.some(user =>
            (typeof user === "string" ? user.toLowerCase() : user.email?.toLowerCase()) === normalizedEmail
        );
        if (!exists) {
            users.push({ name: name.trim(), email: normalizedEmail, registrationId });
            saveData(STORAGE_KEYS.users, users);
        }
        return;
    }

    const normalizedEmail = (email || "").trim().toLowerCase();
    const userId = encodeURIComponent(registrationId || normalizedEmail);
    const userRef = db.collection("users").doc(userId);

    try {
        const existing = await userRef.get();
        if (!existing.exists) {
            await userRef.set({
                name: name.trim(),
                email: normalizedEmail,
                registrationId: registrationId || "",
                registeredAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    } catch (error) {
        console.error("Shared user registration error:", error);
        alert("Could not connect to the shared user database. Please check the Firebase setup.");
        throw error;
    }
}

function getUserCount() {
    // The live Firebase listener updates the number on the Home page.
    const users = loadData(STORAGE_KEYS.users);
    return users.length;
}

async function listenRegisteredUserCount() {
    const countElement = document.getElementById("registeredCount");

    if (!countElement) {
        return;
    }

    try {
        const { count, error } = await supabaseClient
            .from("profiles")
            .select("*", { count: "exact", head: true });

        if (error) {
            console.error("Unable to read Supabase user count:", error);
            countElement.textContent = "—";
            return;
        }

        countElement.textContent = count ?? 0;

    } catch (error) {
        console.error("Unable to read registered user count:", error);
        countElement.textContent = "—";
    }
}
// ============================================================
// PROFILE MANAGER
// ============================================================

function generateUserId() {
    // A random UUID prevents different users from receiving the same profile ID.
    // The fallback also works in older browsers.
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return `QMP-${window.crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    }

    return `QMP-${Date.now().toString(36).toUpperCase()}-${Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase()}`;
}

function registerProfile(name, email = "", registrationId = "") {
    const profiles = loadData(STORAGE_KEYS.profiles);

    const existingIndex = profiles.findIndex(profile =>
        (email && profile.email && profile.email.toLowerCase() === email.toLowerCase()) ||
        profile.name.toLowerCase() === name.toLowerCase()
    );

    if (existingIndex !== -1) {

    const profile = profiles[existingIndex];

    if (!profile.id) {
        profile.id = registrationId || generateUserId();
    }

    if (email) {
        profile.email = email.toLowerCase();
    }

    profiles[existingIndex] = profile;

    saveData(STORAGE_KEYS.profiles, profiles);

    return profile;
}

    const profile = {
        name: name,
        email: email.toLowerCase(),
        id: registrationId || generateUserId(),
        registered: getCurrentDate(),
        totalQuizzes: 0,
        highestScore: 0,
        bestBadge: "None",
        averageAccuracy: 0
    };

    profiles.push(profile);
    saveData(STORAGE_KEYS.profiles, profiles);
    return profile;
}

function getProfile(name) {
    const profiles = loadData(STORAGE_KEYS.profiles);
    return profiles.find(profile =>
        profile.name.toLowerCase() === name.toLowerCase()
    );
}

function getProfileByEmail(email) {
    const profiles = loadData(STORAGE_KEYS.profiles);
    return profiles.find(profile =>
        profile.email && profile.email.toLowerCase() === email.toLowerCase()
    );
}

function getProfileById(id) {
    const profiles = loadData(STORAGE_KEYS.profiles);
    return profiles.find(profile => profile.id.toLowerCase() === id.toLowerCase());
}

function getBetterBadge(oldBadge, newBadge) {

    const rank = {
        "None": 0,
        "Bronze": 1,
        "Silver": 2,
        "Gold": 3
    };

    if ((rank[newBadge] || 0) > (rank[oldBadge] || 0)) {
        return newBadge;
    }

    return oldBadge;
}

function updateProfile(player, score, badge, accuracy) {

    const profiles = loadData(STORAGE_KEYS.profiles);

    const index = profiles.findIndex(
        profile => profile.name.toLowerCase() === player.toLowerCase()
    );

    if (index === -1) {
        return;
    }

    const profile = profiles[index];

    const oldTotal = profile.totalQuizzes;

    profile.totalQuizzes = oldTotal + 1;

    profile.highestScore = Math.max(
        profile.highestScore,
        score
    );

    profile.bestBadge = getBetterBadge(
        profile.bestBadge,
        badge
    );

    profile.averageAccuracy =
        (
            profile.averageAccuracy * oldTotal +
            accuracy
        ) / profile.totalQuizzes;

    profiles[index] = profile;

    saveData(STORAGE_KEYS.profiles, profiles);
}


// ============================================================
// HISTORY MANAGER
// ============================================================

function saveHistory(
    player,
    category,
    score,
    correct,
    wrong,
    skipped,
    accuracy,
    badge
) {

    const history = loadData(STORAGE_KEYS.history);

    history.push({
        player: player,
        category: category,
        score: score,
        correct: correct,
        wrong: wrong,
        skipped: skipped,
        accuracy: accuracy,
        badge: badge,
        date: getCurrentDateTime()
    });

    saveData(STORAGE_KEYS.history, history);
}

function getLeaderboard(category) {

    const history = loadData(STORAGE_KEYS.history);

    const bestResults = {};

    history.forEach(result => {

        if (
            result.category.toLowerCase() !==
            category.toLowerCase()
        ) {
            return;
        }

        const player = result.player;

        if (!bestResults[player]) {

            bestResults[player] = result;

        } else {

            const oldResult = bestResults[player];

            if (
                result.score > oldResult.score ||
                (
                    result.score === oldResult.score &&
                    result.accuracy > oldResult.accuracy
                )
            ) {
                bestResults[player] = result;
            }
        }
    });

    return Object.values(bestResults).sort((a, b) => {

        if (b.score !== a.score) {
            return b.score - a.score;
        }

        return b.accuracy - a.accuracy;
    });
}


// ============================================================
// DATE / TIME
// ============================================================

function getCurrentDate() {

    const now = new Date();

    const year = now.getFullYear();

    const month = String(
        now.getMonth() + 1
    ).padStart(2, "0");

    const day = String(
        now.getDate()
    ).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function getCurrentDateTime() {

    const now = new Date();

    const day = String(
        now.getDate()
    ).padStart(2, "0");

    const month = String(
        now.getMonth() + 1
    ).padStart(2, "0");

    const year = now.getFullYear();

    const hours = String(
        now.getHours()
    ).padStart(2, "0");

    const minutes = String(
        now.getMinutes()
    ).padStart(2, "0");

    return `${day}-${month}-${year} ${hours}:${minutes}`;
}


// ============================================================
// QUESTION LOADER
// ============================================================

// Built-in copy of the question bank makes the app work even when
// index.html is opened directly with file://. When the app is run
// from a web server, questions.txt is still used as the primary source.
const BUILTIN_QUESTIONS = [
    {
        "category": "Java",
        "difficulty": "Easy",
        "question": "Which keyword is used to create an object?",
        "options": [
            "class",
            "new",
            "object",
            "create"
        ],
        "correctAnswer": "new",
        "hint": "Look at the purpose of each Java keyword or modifier before selecting one.",
        "explanation": "Correct answer: new.\nThe key idea is: Objects are created using a keyword.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as class, object, create represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Easy",
        "question": "Which method is the entry point of a Java program?",
        "options": [
            "start()",
            "main()",
            "run()",
            "init()"
        ],
        "correctAnswer": "main()",
        "hint": "Focus on the Java language rule being tested and eliminate options that are not valid Java constructs.",
        "explanation": "Correct answer: main().\nThe key idea is: Every Java application starts with this method.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as start(), run(), init() represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Easy",
        "question": "Which package contains the Scanner class?",
        "options": [
            "java.io",
            "java.util",
            "java.lang",
            "java.net"
        ],
        "correctAnswer": "java.util",
        "hint": "Focus on the Java language rule being tested and eliminate options that are not valid Java constructs.",
        "explanation": "Correct answer: java.util.\nThe key idea is: Scanner belongs to the utility package.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as java.io, java.lang, java.net represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Medium",
        "question": "Which collection does not allow duplicate elements?",
        "options": [
            "ArrayList",
            "HashSet",
            "LinkedList",
            "Vector"
        ],
        "correctAnswer": "HashSet",
        "hint": "Compare the collection characteristics such as ordering, uniqueness, and key-value storage.",
        "explanation": "Correct answer: HashSet.\nThe key idea is: Think about mathematical sets.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as ArrayList, LinkedList, Vector represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Hard",
        "question": "Which keyword prevents a class from being inherited?",
        "options": [
            "private",
            "static",
            "final",
            "const"
        ],
        "correctAnswer": "final",
        "hint": "Look at the purpose of each Java keyword or modifier before selecting one.",
        "explanation": "Correct answer: final.\nThe key idea is: This keyword is also used for methods and variables.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as private, static, const represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Easy",
        "question": "Which keyword is used to inherit a class?",
        "options": [
            "implements",
            "extends",
            "inherits",
            "super"
        ],
        "correctAnswer": "extends",
        "hint": "Look at the purpose of each Java keyword or modifier before selecting one.",
        "explanation": "Correct answer: extends.\nThe key idea is: The extends keyword is used for class inheritance.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as implements, inherits, super represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Easy",
        "question": "Which data type is used to store true or false?",
        "options": [
            "int",
            "boolean",
            "char",
            "float"
        ],
        "correctAnswer": "boolean",
        "hint": "Focus on the Java language rule being tested and eliminate options that are not valid Java constructs.",
        "explanation": "Correct answer: boolean.\nThe key idea is: Boolean values can be true or false.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as int, char, float represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Easy",
        "question": "Which symbol is used for single-line comments in Java?",
        "options": [
            "#",
            "//",
            "--",
            "/*"
        ],
        "correctAnswer": "//",
        "hint": "Focus on the Java language rule being tested and eliminate options that are not valid Java constructs.",
        "explanation": "Correct answer: //.\nThe key idea is: Two forward slashes start a single-line comment.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as #, --, /* represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Easy",
        "question": "Which keyword is used to create a constant variable?",
        "options": [
            "constant",
            "final",
            "static",
            "fixed"
        ],
        "correctAnswer": "final",
        "hint": "Look at the purpose of each Java keyword or modifier before selecting one.",
        "explanation": "Correct answer: final.\nThe key idea is: A final variable cannot be reassigned.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as constant, static, fixed represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Easy",
        "question": "Which class is the parent of all Java classes?",
        "options": [
            "Main",
            "Object",
            "Class",
            "Parent"
        ],
        "correctAnswer": "Object",
        "hint": "Focus on the Java language rule being tested and eliminate options that are not valid Java constructs.",
        "explanation": "Correct answer: Object.\nThe key idea is: Every Java class directly or indirectly inherits from Object.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as Main, Class, Parent represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Medium",
        "question": "Which concept allows the same method name with different parameters?",
        "options": [
            "Inheritance",
            "Encapsulation",
            "Method Overloading",
            "Abstraction"
        ],
        "correctAnswer": "Method Overloading",
        "hint": "Focus on the Java language rule being tested and eliminate options that are not valid Java constructs.",
        "explanation": "Correct answer: Method Overloading.\nThe key idea is: Overloading uses the same method name with different parameter lists.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as Inheritance, Encapsulation, Abstraction represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Medium",
        "question": "Which keyword refers to the current object?",
        "options": [
            "this",
            "self",
            "current",
            "object"
        ],
        "correctAnswer": "this",
        "hint": "Look at the purpose of each Java keyword or modifier before selecting one.",
        "explanation": "Correct answer: this.\nThe key idea is: The this keyword refers to the current object.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as self, current, object represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Medium",
        "question": "Which keyword is used to call the parent class constructor?",
        "options": [
            "this",
            "parent",
            "super",
            "base"
        ],
        "correctAnswer": "super",
        "hint": "Look at the purpose of each Java keyword or modifier before selecting one.",
        "explanation": "Correct answer: super.\nThe key idea is: super can access the parent class constructor.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as this, parent, base represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Medium",
        "question": "Which interface is commonly used to create a thread?",
        "options": [
            "Runnable",
            "Threadable",
            "Executable",
            "Process"
        ],
        "correctAnswer": "Runnable",
        "hint": "Focus on the Java mechanism used for the specific runtime task mentioned.",
        "explanation": "Correct answer: Runnable.\nThe key idea is: Runnable is used to define code that can run in a thread.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as Threadable, Executable, Process represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Medium",
        "question": "Which access modifier provides the widest access?",
        "options": [
            "private",
            "protected",
            "public",
            "default"
        ],
        "correctAnswer": "public",
        "hint": "Look at the purpose of each Java keyword or modifier before selecting one.",
        "explanation": "Correct answer: public.\nThe key idea is: Public members can be accessed from anywhere.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as private, protected, default represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Hard",
        "question": "Which mechanism allows Java to run on different platforms?",
        "options": [
            "Pointers",
            "Bytecode",
            "Preprocessor",
            "Machine code"
        ],
        "correctAnswer": "Bytecode",
        "hint": "Focus on the Java language rule being tested and eliminate options that are not valid Java constructs.",
        "explanation": "Correct answer: Bytecode.\nThe key idea is: Java bytecode runs on the JVM.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as Pointers, Preprocessor, Machine code represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Hard",
        "question": "Which exception occurs when dividing an integer by zero?",
        "options": [
            "NullPointerException",
            "ArithmeticException",
            "IOException",
            "ClassNotFoundException"
        ],
        "correctAnswer": "ArithmeticException",
        "hint": "Focus on the Java mechanism used for the specific runtime task mentioned.",
        "explanation": "Correct answer: ArithmeticException.\nThe key idea is: Division by zero causes ArithmeticException.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as NullPointerException, IOException, ClassNotFoundException represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Hard",
        "question": "Which keyword is used to explicitly throw an exception?",
        "options": [
            "throws",
            "throw",
            "catch",
            "try"
        ],
        "correctAnswer": "throw",
        "hint": "Look at the purpose of each Java keyword or modifier before selecting one.",
        "explanation": "Correct answer: throw.\nThe key idea is: The throw keyword explicitly throws an exception.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as throws, catch, try represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Hard",
        "question": "Which collection stores elements in key-value pairs?",
        "options": [
            "ArrayList",
            "HashSet",
            "HashMap",
            "LinkedList"
        ],
        "correctAnswer": "HashMap",
        "hint": "Compare the collection characteristics such as ordering, uniqueness, and key-value storage.",
        "explanation": "Correct answer: HashMap.\nThe key idea is: HashMap stores data as key-value pairs.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as ArrayList, HashSet, LinkedList represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Hard",
        "question": "Which feature hides implementation details from the user?",
        "options": [
            "Inheritance",
            "Abstraction",
            "Polymorphism",
            "Compilation"
        ],
        "correctAnswer": "Abstraction",
        "hint": "Identify the object-oriented relationship described, then eliminate unrelated concepts.",
        "explanation": "Correct answer: Abstraction.\nThe key idea is: Abstraction hides unnecessary implementation details.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as Inheritance, Polymorphism, Compilation represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "C",
        "difficulty": "Easy",
        "question": "Who developed the C programming language?",
        "options": [
            "Dennis Ritchie",
            "James Gosling",
            "Bjarne Stroustrup",
            "Guido van Rossum"
        ],
        "correctAnswer": "Dennis Ritchie",
        "hint": "Focus on the C syntax, memory rule, or standard-library role described by the question.",
        "explanation": "Correct answer: Dennis Ritchie.\nThe key idea is: He developed C at Bell Labs.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as James Gosling, Bjarne Stroustrup, Guido van Rossum, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Easy",
        "question": "Which symbol ends a statement in C?",
        "options": [
            ":",
            ".",
            ";",
            ","
        ],
        "correctAnswer": ";",
        "hint": "Focus on the C syntax, memory rule, or standard-library role described by the question.",
        "explanation": "Correct answer: ;.\nThe key idea is: Every C statement ends with this symbol.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as :, ., ,, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Easy",
        "question": "Which function is the entry point of a C program?",
        "options": [
            "begin()",
            "start()",
            "main()",
            "init()"
        ],
        "correctAnswer": "main()",
        "hint": "Focus on the C syntax, memory rule, or standard-library role described by the question.",
        "explanation": "Correct answer: main().\nThe key idea is: Execution begins here.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as begin(), start(), init(), are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Medium",
        "question": "Which header file is required for printf()?",
        "options": [
            "math.h",
            "string.h",
            "stdio.h",
            "stdlib.h"
        ],
        "correctAnswer": "stdio.h",
        "hint": "Match the operation with the C format or input-output convention it requires.",
        "explanation": "Correct answer: stdio.h.\nThe key idea is: Standard Input Output library.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as math.h, string.h, stdlib.h, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Hard",
        "question": "Which storage class retains a variable's value between function calls?",
        "options": [
            "auto",
            "register",
            "static",
            "extern"
        ],
        "correctAnswer": "static",
        "hint": "Focus on the C syntax, memory rule, or standard-library role described by the question.",
        "explanation": "Correct answer: static.\nThe key idea is: Its value persists across function calls.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as auto, register, extern, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Easy",
        "question": "Which format specifier is used to print an integer?",
        "options": [
            "%f",
            "%c",
            "%d",
            "%s"
        ],
        "correctAnswer": "%d",
        "hint": "Match the operation with the C format or input-output convention it requires.",
        "explanation": "Correct answer: %d.\nThe key idea is: The %d format specifier is used for integers.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as %f, %c, %s, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Easy",
        "question": "Which format specifier is used for a character?",
        "options": [
            "%d",
            "%c",
            "%f",
            "%s"
        ],
        "correctAnswer": "%c",
        "hint": "Match the operation with the C format or input-output convention it requires.",
        "explanation": "Correct answer: %c.\nThe key idea is: The %c format specifier is used for characters.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as %d, %f, %s, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Easy",
        "question": "Which operator is used to get the address of a variable?",
        "options": [
            "*",
            "&",
            "%",
            "@"
        ],
        "correctAnswer": "&",
        "hint": "Distinguish between an address, a pointer, and the value stored at that address.",
        "explanation": "Correct answer: &.\nThe key idea is: The ampersand operator gives the address of a variable.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as *, %, @, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Easy",
        "question": "Which operator is used to access the value at an address?",
        "options": [
            "",
            "",
            "",
            ""
        ],
        "correctAnswer": "*",
        "hint": "Distinguish between an address, a pointer, and the value stored at that address.",
        "explanation": "Correct answer: *.\nThe key idea is: The dereference operator accesses the value stored at an address.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as , , , are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Easy",
        "question": "Which keyword is used to declare a constant in C?",
        "options": [
            "fixed",
            "const",
            "constant",
            "final"
        ],
        "correctAnswer": "const",
        "hint": "Focus on the C syntax, memory rule, or standard-library role described by the question.",
        "explanation": "Correct answer: const.\nThe key idea is: The const keyword prevents modification of a value.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as fixed, constant, final, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Medium",
        "question": "Which loop executes its body at least once?",
        "options": [
            "for",
            "while",
            "do-while",
            "foreach"
        ],
        "correctAnswer": "do-while",
        "hint": "Check when the condition is tested and how control moves to the next iteration.",
        "explanation": "Correct answer: do-while.\nThe key idea is: The condition is checked after the loop body.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as for, while, foreach, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Medium",
        "question": "Which function is used to allocate memory dynamically?",
        "options": [
            "malloc()",
            "alloc()",
            "memory()",
            "new()"
        ],
        "correctAnswer": "malloc()",
        "hint": "Focus on when memory is obtained, used, and released during program execution.",
        "explanation": "Correct answer: malloc().\nThe key idea is: malloc allocates memory dynamically.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as alloc(), memory(), new(), are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Medium",
        "question": "Which function releases dynamically allocated memory?",
        "options": [
            "delete()",
            "remove()",
            "free()",
            "release()"
        ],
        "correctAnswer": "free()",
        "hint": "Focus on when memory is obtained, used, and released during program execution.",
        "explanation": "Correct answer: free().\nThe key idea is: free releases dynamically allocated memory.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as delete(), remove(), release(), are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Medium",
        "question": "Which operator is used to access a structure member through a pointer?",
        "options": [
            ".",
            "->",
            "&",
            "*"
        ],
        "correctAnswer": "->",
        "hint": "Distinguish between an address, a pointer, and the value stored at that address.",
        "explanation": "Correct answer: ->.\nThe key idea is: The arrow operator accesses structure members through pointers.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as ., &, *, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Medium",
        "question": "Which keyword is used to define a structure?",
        "options": [
            "struct",
            "structure",
            "record",
            "class"
        ],
        "correctAnswer": "struct",
        "hint": "Focus on the C syntax, memory rule, or standard-library role described by the question.",
        "explanation": "Correct answer: struct.\nThe key idea is: The struct keyword defines a structure.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as structure, record, class, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Hard",
        "question": "What is the size of a pointer dependent on?",
        "options": [
            "Pointed data only",
            "Operating system and architecture",
            "Variable name",
            "Compiler comments"
        ],
        "correctAnswer": "Operating system and architecture",
        "hint": "Distinguish between an address, a pointer, and the value stored at that address.",
        "explanation": "Correct answer: Operating system and architecture.\nThe key idea is: Pointer size depends mainly on the system architecture.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as Pointed data only, Variable name, Compiler comments, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Hard",
        "question": "Which function is used to compare two strings?",
        "options": [
            "strcompare()",
            "strcmp()",
            "compare()",
            "stringcmp()"
        ],
        "correctAnswer": "strcmp()",
        "hint": "Focus on the C syntax, memory rule, or standard-library role described by the question.",
        "explanation": "Correct answer: strcmp().\nThe key idea is: strcmp compares two strings.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as strcompare(), compare(), stringcmp(), are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Hard",
        "question": "Which function copies one string into another?",
        "options": [
            "strcopy()",
            "copystr()",
            "strcpy()",
            "stringcopy()"
        ],
        "correctAnswer": "strcpy()",
        "hint": "Focus on the C syntax, memory rule, or standard-library role described by the question.",
        "explanation": "Correct answer: strcpy().\nThe key idea is: strcpy copies a string.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as strcopy(), copystr(), stringcopy(), are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Hard",
        "question": "What does recursion mean in programming?",
        "options": [
            "Using arrays",
            "A function calling itself",
            "Using pointers",
            "Creating structures"
        ],
        "correctAnswer": "A function calling itself",
        "hint": "Focus on the C syntax, memory rule, or standard-library role described by the question.",
        "explanation": "Correct answer: A function calling itself.\nThe key idea is: A recursive function calls itself.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as Using arrays, Using pointers, Creating structures, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Hard",
        "question": "Which header file contains string handling functions?",
        "options": [
            "stdio.h",
            "stdlib.h",
            "string.h",
            "math.h"
        ],
        "correctAnswer": "string.h",
        "hint": "Focus on the C syntax, memory rule, or standard-library role described by the question.",
        "explanation": "Correct answer: string.h.\nThe key idea is: String functions such as strcpy and strcmp are declared in string.h.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as stdio.h, stdlib.h, math.h, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "Python",
        "difficulty": "Easy",
        "question": "Which keyword defines a function in Python?",
        "options": [
            "function",
            "func",
            "def",
            "define"
        ],
        "correctAnswer": "def",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: def.\nThe key idea is: Python uses a short keyword.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives function, func, define have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Easy",
        "question": "Which symbol starts a comment in Python?",
        "options": [
            "//",
            "#",
            "/*",
            "--"
        ],
        "correctAnswer": "#",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: #.\nThe key idea is: Used for single-line comments.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives //, /*, -- have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Easy",
        "question": "Which data type stores key-value pairs?",
        "options": [
            "List",
            "Tuple",
            "Dictionary",
            "Set"
        ],
        "correctAnswer": "Dictionary",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: Dictionary.\nThe key idea is: Also called dict.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives List, Tuple, Set have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Medium",
        "question": "Which function displays output on the screen?",
        "options": [
            "display()",
            "echo()",
            "print()",
            "show()"
        ],
        "correctAnswer": "print()",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: print().\nThe key idea is: The most commonly used output function.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives display(), echo(), show() have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Hard",
        "question": "Which keyword is used to handle exceptions?",
        "options": [
            "catch",
            "except",
            "error",
            "finally"
        ],
        "correctAnswer": "except",
        "hint": "Identify the Python runtime situation described and match it to its exception behavior.",
        "explanation": "Correct answer: except.\nThe key idea is: Used with try blocks.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives catch, error, finally have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Easy",
        "question": "Which function is used to find the length of a list?",
        "options": [
            "size()",
            "length()",
            "len()",
            "count()"
        ],
        "correctAnswer": "len()",
        "hint": "Compare the collection’s ordering, mutability, uniqueness, or key-value behavior.",
        "explanation": "Correct answer: len().\nThe key idea is: The len function returns the number of elements.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives size(), length(), count() have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Easy",
        "question": "Which symbol is used to create a list?",
        "options": [
            "()",
            "{}",
            "[]",
            "<>"
        ],
        "correctAnswer": "[]",
        "hint": "Compare the collection’s ordering, mutability, uniqueness, or key-value behavior.",
        "explanation": "Correct answer: [].\nThe key idea is: Square brackets are used to create lists.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives (), {}, <> have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Easy",
        "question": "Which symbol is used to create a tuple?",
        "options": [
            "[]",
            "{}",
            "()",
            "<>"
        ],
        "correctAnswer": "()",
        "hint": "Compare the collection’s ordering, mutability, uniqueness, or key-value behavior.",
        "explanation": "Correct answer: ().\nThe key idea is: Parentheses are commonly used for tuples.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives [], {}, <> have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Easy",
        "question": "Which keyword is used to create a class?",
        "options": [
            "class",
            "struct",
            "define",
            "object"
        ],
        "correctAnswer": "class",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: class.\nThe key idea is: The class keyword defines a class.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives struct, define, object have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Easy",
        "question": "Which function converts a string into an integer?",
        "options": [
            "str()",
            "float()",
            "int()",
            "number()"
        ],
        "correctAnswer": "int()",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: int().\nThe key idea is: The int function converts a value to an integer.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives str(), float(), number() have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Medium",
        "question": "Which operator is used for exponentiation in Python?",
        "options": [
            "^",
            "**",
            "//",
            "%%"
        ],
        "correctAnswer": "**",
        "hint": "Check the operator’s exact Python meaning rather than relying on its appearance.",
        "explanation": "Correct answer: **.\nThe key idea is: Double asterisk is used for powers.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives ^, //, %% have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Medium",
        "question": "What does the // operator perform?",
        "options": [
            "Division",
            "Floor division",
            "Multiplication",
            "Modulus"
        ],
        "correctAnswer": "Floor division",
        "hint": "Check the operator’s exact Python meaning rather than relying on its appearance.",
        "explanation": "Correct answer: Floor division.\nThe key idea is: It returns the floor value of a division.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives Division, Multiplication, Modulus have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Medium",
        "question": "Which method adds an element to the end of a list?",
        "options": [
            "add()",
            "insert()",
            "append()",
            "push()"
        ],
        "correctAnswer": "append()",
        "hint": "Compare the collection’s ordering, mutability, uniqueness, or key-value behavior.",
        "explanation": "Correct answer: append().\nThe key idea is: append adds an element to the end.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives add(), insert(), push() have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Medium",
        "question": "Which keyword is used to create a loop over a sequence?",
        "options": [
            "loop",
            "for",
            "repeat",
            "iterate"
        ],
        "correctAnswer": "for",
        "hint": "Trace the iteration rule carefully, including the starting point and stopping condition.",
        "explanation": "Correct answer: for.\nThe key idea is: The for loop iterates over sequences.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives loop, repeat, iterate have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Medium",
        "question": "Which data type is immutable?",
        "options": [
            "List",
            "Dictionary",
            "Set",
            "Tuple"
        ],
        "correctAnswer": "Tuple",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: Tuple.\nThe key idea is: Tuples cannot be modified after creation.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives List, Dictionary, Set have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Hard",
        "question": "What is the output type of the range() function?",
        "options": [
            "List",
            "Tuple",
            "Range object",
            "Set"
        ],
        "correctAnswer": "Range object",
        "hint": "Trace the iteration rule carefully, including the starting point and stopping condition.",
        "explanation": "Correct answer: Range object.\nThe key idea is: range creates a range object.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives List, Tuple, Set have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Hard",
        "question": "Which keyword is used to define an anonymous function?",
        "options": [
            "anonymous",
            "lambda",
            "function",
            "def"
        ],
        "correctAnswer": "lambda",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: lambda.\nThe key idea is: Lambda creates small anonymous functions.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives anonymous, function, def have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Hard",
        "question": "Which keyword is used to import a module?",
        "options": [
            "include",
            "using",
            "import",
            "require"
        ],
        "correctAnswer": "import",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: import.\nThe key idea is: Python uses import to load modules.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives include, using, require have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Hard",
        "question": "Which exception occurs when accessing an invalid list index?",
        "options": [
            "KeyError",
            "IndexError",
            "ValueError",
            "TypeError"
        ],
        "correctAnswer": "IndexError",
        "hint": "Compare the collection’s ordering, mutability, uniqueness, or key-value behavior.",
        "explanation": "Correct answer: IndexError.\nThe key idea is: An invalid list index causes IndexError.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives KeyError, ValueError, TypeError have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Hard",
        "question": "Which data structure does not allow duplicate values?",
        "options": [
            "List",
            "Tuple",
            "Set",
            "Dictionary"
        ],
        "correctAnswer": "Set",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: Set.\nThe key idea is: A set stores unique values.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives List, Tuple, Dictionary have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Aptitude",
        "difficulty": "Easy",
        "question": "What is 25 × 4?",
        "options": [
            "80",
            "90",
            "100",
            "120"
        ],
        "correctAnswer": "100",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 100.\nThe key idea is: Multiply 25 by 4.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 80, 90, 120, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Easy",
        "question": "What is 144 ÷ 12?",
        "options": [
            "10",
            "11",
            "12",
            "13"
        ],
        "correctAnswer": "12",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 12.\nThe key idea is: Basic division.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 10, 11, 13, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Medium",
        "question": "A train travels 60 km in 1 hour. How far will it travel in 5 hours?",
        "options": [
            "200",
            "240",
            "300",
            "350"
        ],
        "correctAnswer": "300",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 300.\nThe key idea is: Distance = Speed × Time.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 200, 240, 350, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Medium",
        "question": "If the cost price is ₹400 and selling price is ₹500, what is the profit?",
        "options": [
            "₹50",
            "₹80",
            "₹100",
            "₹120"
        ],
        "correctAnswer": "₹100",
        "hint": "Compare selling price and cost price using the standard profit or loss relationship.",
        "explanation": "Correct answer: ₹100.\nThe key idea is: Profit = SP − CP.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including ₹50, ₹80, ₹120, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Hard",
        "question": "What is 20% of 250?",
        "options": [
            "40",
            "45",
            "50",
            "55"
        ],
        "correctAnswer": "50",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 50.\nThe key idea is: Convert percentage to decimal.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 40, 45, 55, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Easy",
        "question": "What is 15% of 200?",
        "options": [
            "20",
            "25",
            "30",
            "35"
        ],
        "correctAnswer": "30",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 30.\nThe key idea is: 15 percent of 200 is 30.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 20, 25, 35, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Easy",
        "question": "What is the average of 10 and 20?",
        "options": [
            "10",
            "15",
            "20",
            "25"
        ],
        "correctAnswer": "15",
        "hint": "Use the definition of average and work backward or forward as required.",
        "explanation": "Correct answer: 15.\nThe key idea is: Average is the sum divided by the number of values.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 10, 20, 25, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Easy",
        "question": "If x = 5, what is 2x + 3?",
        "options": [
            "10",
            "11",
            "13",
            "15"
        ],
        "correctAnswer": "13",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 13.\nThe key idea is: Substitute x with 5.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 10, 11, 15, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Easy",
        "question": "What is 7 × 8?",
        "options": [
            "54",
            "56",
            "58",
            "64"
        ],
        "correctAnswer": "56",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 56.\nThe key idea is: Basic multiplication.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 54, 58, 64, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Easy",
        "question": "What is 1000 − 375?",
        "options": [
            "525",
            "625",
            "675",
            "725"
        ],
        "correctAnswer": "625",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 625.\nThe key idea is: Subtract 375 from 1000.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 525, 675, 725, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Medium",
        "question": "A product costs ₹800 and is sold for ₹1000. What is the profit percentage?",
        "options": [
            "20%",
            "25%",
            "30%",
            "35%"
        ],
        "correctAnswer": "25%",
        "hint": "Convert the percentage into a fraction or decimal before calculating.",
        "explanation": "Correct answer: 25%.\nThe key idea is: Profit is ₹200, which is 25% of ₹800.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 20%, 30%, 35%, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Medium",
        "question": "A number is increased from 100 to 120. What is the percentage increase?",
        "options": [
            "10%",
            "15%",
            "20%",
            "25%"
        ],
        "correctAnswer": "20%",
        "hint": "Convert the percentage into a fraction or decimal before calculating.",
        "explanation": "Correct answer: 20%.\nThe key idea is: The increase is 20 out of 100.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 10%, 15%, 25%, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Medium",
        "question": "If 5 workers complete a job in 10 days, how many worker-days are required?",
        "options": [
            "15",
            "25",
            "50",
            "100"
        ],
        "correctAnswer": "50",
        "hint": "Think in terms of total work and worker-days rather than only the number of people.",
        "explanation": "Correct answer: 50.\nThe key idea is: Worker-days = workers × days.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 15, 25, 100, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Medium",
        "question": "A car travels at 60 km/h for 2.5 hours. What distance does it cover?",
        "options": [
            "120 km",
            "150 km",
            "180 km",
            "200 km"
        ],
        "correctAnswer": "150 km",
        "hint": "Write the basic distance-speed-time relationship before substituting numbers.",
        "explanation": "Correct answer: 150 km.\nThe key idea is: Distance = speed × time.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 120 km, 180 km, 200 km, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Medium",
        "question": "What is the simple interest on ₹5000 at 10% per year for 2 years?",
        "options": [
            "₹500",
            "₹750",
            "₹1000",
            "₹1500"
        ],
        "correctAnswer": "₹1000",
        "hint": "Identify principal, rate, and time, then use the standard interest relationship.",
        "explanation": "Correct answer: ₹1000.\nThe key idea is: SI = P × R × T / 100.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including ₹500, ₹750, ₹1500, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Hard",
        "question": "If a:b = 2:3 and b:c = 4:5, what is a:c?",
        "options": [
            "2:5",
            "8:15",
            "3:5",
            "4:15"
        ],
        "correctAnswer": "8:15",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 8:15.\nThe key idea is: Make the common value b equal to 12.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 2:5, 3:5, 4:15, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Hard",
        "question": "A train 120 m long crosses a pole in 6 seconds. What is its speed?",
        "options": [
            "15 m/s",
            "20 m/s",
            "25 m/s",
            "30 m/s"
        ],
        "correctAnswer": "20 m/s",
        "hint": "Write the basic distance-speed-time relationship before substituting numbers.",
        "explanation": "Correct answer: 20 m/s.\nThe key idea is: Speed = distance divided by time.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 15 m/s, 25 m/s, 30 m/s, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Hard",
        "question": "What is the next number: 2, 6, 12, 20, 30, ?",
        "options": [
            "36",
            "40",
            "42",
            "44"
        ],
        "correctAnswer": "42",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 42.\nThe key idea is: The differences are 4, 6, 8, 10, then 12.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 36, 40, 44, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Hard",
        "question": "If 3x + 5 = 20, what is x?",
        "options": [
            "3",
            "5",
            "7",
            "10"
        ],
        "correctAnswer": "5",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 5.\nThe key idea is: Subtract 5 and divide by 3.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 3, 7, 10, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Hard",
        "question": "A shop gives a 20% discount on an item priced at ₹1500. What is the selling price?",
        "options": [
            "₹1100",
            "₹1200",
            "₹1250",
            "₹1300"
        ],
        "correctAnswer": "₹1200",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: ₹1200.\nThe key idea is: 20% of ₹1500 is ₹300, so the price is ₹1200.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including ₹1100, ₹1250, ₹1300, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "GK",
        "difficulty": "Easy",
        "question": "What is the capital of India?",
        "options": [
            "Mumbai",
            "Delhi",
            "Hyderabad",
            "Chennai"
        ],
        "correctAnswer": "Delhi",
        "hint": "Recall the standard geographical association rather than a nearby or related place.",
        "explanation": "Correct answer: Delhi.\nThe key idea is: It is India's national capital.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Mumbai, Hyderabad, Chennai are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Easy",
        "question": "Which planet is called the Red Planet?",
        "options": [
            "Earth",
            "Mars",
            "Venus",
            "Jupiter"
        ],
        "correctAnswer": "Mars",
        "hint": "Match the defining property in the question with the correct standard fact.",
        "explanation": "Correct answer: Mars.\nThe key idea is: Named after the Roman god of war.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Earth, Venus, Jupiter are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Easy",
        "question": "Who is known as the Father of the Nation in India?",
        "options": [
            "Jawaharlal Nehru",
            "Subhas Chandra Bose",
            "Mahatma Gandhi",
            "Bhagat Singh"
        ],
        "correctAnswer": "Mahatma Gandhi",
        "hint": "Think of the person most directly associated with the named contribution.",
        "explanation": "Correct answer: Mahatma Gandhi.\nThe key idea is: He led India's freedom movement.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Jawaharlal Nehru, Subhas Chandra Bose, Bhagat Singh are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Medium",
        "question": "Which is the largest ocean in the world?",
        "options": [
            "Indian Ocean",
            "Atlantic Ocean",
            "Pacific Ocean",
            "Arctic Ocean"
        ],
        "correctAnswer": "Pacific Ocean",
        "hint": "Recall the standard fact connected with the person, place, term, event, or object in the question.",
        "explanation": "Correct answer: Pacific Ocean.\nThe key idea is: It covers the largest area.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Indian Ocean, Atlantic Ocean, Arctic Ocean are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Hard",
        "question": "How many fundamental rights are guaranteed by the Constitution of India?",
        "options": [
            "5",
            "6",
            "7",
            "8"
        ],
        "correctAnswer": "6",
        "hint": "Recall the standard fact connected with the person, place, term, event, or object in the question.",
        "explanation": "Correct answer: 6.\nThe key idea is: These are listed in Part III of the Constitution.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives 5, 7, 8 are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Easy",
        "question": "What is the national animal of India?",
        "options": [
            "Lion",
            "Tiger",
            "Elephant",
            "Peacock"
        ],
        "correctAnswer": "Tiger",
        "hint": "Recall the standard fact connected with the person, place, term, event, or object in the question.",
        "explanation": "Correct answer: Tiger.\nThe key idea is: The Bengal tiger is India's national animal.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Lion, Elephant, Peacock are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Easy",
        "question": "What is the national bird of India?",
        "options": [
            "Sparrow",
            "Peacock",
            "Eagle",
            "Parrot"
        ],
        "correctAnswer": "Peacock",
        "hint": "Recall the standard fact connected with the person, place, term, event, or object in the question.",
        "explanation": "Correct answer: Peacock.\nThe key idea is: The Indian peacock is India's national bird.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Sparrow, Eagle, Parrot are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Easy",
        "question": "Which is the largest continent?",
        "options": [
            "Africa",
            "Asia",
            "Europe",
            "Australia"
        ],
        "correctAnswer": "Asia",
        "hint": "Recall the standard fact connected with the person, place, term, event, or object in the question.",
        "explanation": "Correct answer: Asia.\nThe key idea is: Asia is the largest continent.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Africa, Europe, Australia are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Easy",
        "question": "Which is the smallest continent?",
        "options": [
            "Asia",
            "Europe",
            "Australia",
            "Africa"
        ],
        "correctAnswer": "Australia",
        "hint": "Recall the standard fact connected with the person, place, term, event, or object in the question.",
        "explanation": "Correct answer: Australia.\nThe key idea is: Australia is the smallest continent.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Asia, Europe, Africa are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Easy",
        "question": "How many days are there in a leap year?",
        "options": [
            "364",
            "365",
            "366",
            "367"
        ],
        "correctAnswer": "366",
        "hint": "Place the event or fact on the correct historical timeline.",
        "explanation": "Correct answer: 366.\nThe key idea is: A leap year has 366 days.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives 364, 365, 367 are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Medium",
        "question": "Who wrote the Indian national anthem?",
        "options": [
            "Bankim Chandra Chatterjee",
            "Rabindranath Tagore",
            "Sarojini Naidu",
            "Mahatma Gandhi"
        ],
        "correctAnswer": "Rabindranath Tagore",
        "hint": "Think of the person most directly associated with the named contribution.",
        "explanation": "Correct answer: Rabindranath Tagore.\nThe key idea is: He wrote Jana Gana Mana.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Bankim Chandra Chatterjee, Sarojini Naidu, Mahatma Gandhi are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Medium",
        "question": "Which is the longest river in India?",
        "options": [
            "Yamuna",
            "Ganga",
            "Godavari",
            "Narmada"
        ],
        "correctAnswer": "Ganga",
        "hint": "Match the defining property in the question with the correct standard fact.",
        "explanation": "Correct answer: Ganga.\nThe key idea is: The Ganga is generally considered India's longest river.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Yamuna, Godavari, Narmada are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Medium",
        "question": "Which gas is most abundant in Earth's atmosphere?",
        "options": [
            "Oxygen",
            "Carbon Dioxide",
            "Nitrogen",
            "Hydrogen"
        ],
        "correctAnswer": "Nitrogen",
        "hint": "Recall the standard fact connected with the person, place, term, event, or object in the question.",
        "explanation": "Correct answer: Nitrogen.\nThe key idea is: Nitrogen makes up about 78% of the atmosphere.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Oxygen, Carbon Dioxide, Hydrogen are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Medium",
        "question": "Which organ pumps blood throughout the human body?",
        "options": [
            "Lungs",
            "Brain",
            "Heart",
            "Kidney"
        ],
        "correctAnswer": "Heart",
        "hint": "Match the defining property in the question with the correct standard fact.",
        "explanation": "Correct answer: Heart.\nThe key idea is: The heart pumps blood through the circulatory system.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Lungs, Brain, Kidney are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Medium",
        "question": "Which is the largest planet in our solar system?",
        "options": [
            "Earth",
            "Saturn",
            "Jupiter",
            "Neptune"
        ],
        "correctAnswer": "Jupiter",
        "hint": "Match the defining property in the question with the correct standard fact.",
        "explanation": "Correct answer: Jupiter.\nThe key idea is: Jupiter is the largest planet.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Earth, Saturn, Neptune are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Hard",
        "question": "In which year did India gain independence?",
        "options": [
            "1945",
            "1946",
            "1947",
            "1950"
        ],
        "correctAnswer": "1947",
        "hint": "Place the event or fact on the correct historical timeline.",
        "explanation": "Correct answer: 1947.\nThe key idea is: India became independent on August 15, 1947.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives 1945, 1946, 1950 are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Hard",
        "question": "Who was the first President of India?",
        "options": [
            "Dr. Rajendra Prasad",
            "Jawaharlal Nehru",
            "S. Radhakrishnan",
            "Sardar Patel"
        ],
        "correctAnswer": "Dr. Rajendra Prasad",
        "hint": "Think of the person most directly associated with the named contribution.",
        "explanation": "Correct answer: Dr. Rajendra Prasad.\nThe key idea is: He was India's first President.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Jawaharlal Nehru, S. Radhakrishnan, Sardar Patel are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Hard",
        "question": "Which Article of the Indian Constitution deals with equality before law?",
        "options": [
            "Article 12",
            "Article 14",
            "Article 19",
            "Article 21"
        ],
        "correctAnswer": "Article 14",
        "hint": "Recall the standard fact connected with the person, place, term, event, or object in the question.",
        "explanation": "Correct answer: Article 14.\nThe key idea is: Article 14 guarantees equality before law.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Article 12, Article 19, Article 21 are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Hard",
        "question": "Which is the highest civilian award in India?",
        "options": [
            "Padma Shri",
            "Padma Bhushan",
            "Padma Vibhushan",
            "Bharat Ratna"
        ],
        "correctAnswer": "Bharat Ratna",
        "hint": "Match the defining property in the question with the correct standard fact.",
        "explanation": "Correct answer: Bharat Ratna.\nThe key idea is: Bharat Ratna is India's highest civilian award.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Padma Shri, Padma Bhushan, Padma Vibhushan are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Hard",
        "question": "Where is the headquarters of the United Nations located?",
        "options": [
            "London",
            "Paris",
            "New York",
            "Geneva"
        ],
        "correctAnswer": "New York",
        "hint": "Recall the standard geographical association rather than a nearby or related place.",
        "explanation": "Correct answer: New York.\nThe key idea is: The UN headquarters is in New York City.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives London, Paris, Geneva are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "Java",
        "difficulty": "Easy",
        "question": "Which primitive type stores a single 16-bit Unicode character?",
        "options": [
            "char",
            "byte",
            "string",
            "boolean"
        ],
        "correctAnswer": "char",
        "hint": "Focus on the Java language rule being tested and eliminate options that are not valid Java constructs.",
        "explanation": "Correct answer: char.\nThe key idea is: Think of a single symbol such as A.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as byte, string, boolean represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Easy",
        "question": "Which keyword is used to define a method that belongs to the class rather than an object?",
        "options": [
            "static",
            "object",
            "classonly",
            "shared"
        ],
        "correctAnswer": "static",
        "hint": "Look at the purpose of each Java keyword or modifier before selecting one.",
        "explanation": "Correct answer: static.\nThe key idea is: It is associated with the class itself.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as object, classonly, shared represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Medium",
        "question": "Which OOP concept allows one interface to have multiple implementations?",
        "options": [
            "Polymorphism",
            "Compilation",
            "Packaging",
            "Casting"
        ],
        "correctAnswer": "Polymorphism",
        "hint": "Identify the object-oriented relationship described, then eliminate unrelated concepts.",
        "explanation": "Correct answer: Polymorphism.\nThe key idea is: Think about one form taking different behaviors.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as Compilation, Packaging, Casting represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Medium",
        "question": "Which keyword is used to handle an exception block?",
        "options": [
            "try",
            "throwable",
            "error",
            "exception"
        ],
        "correctAnswer": "try",
        "hint": "Look at the purpose of each Java keyword or modifier before selecting one.",
        "explanation": "Correct answer: try.\nThe key idea is: The protected block is placed after this keyword.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as throwable, error, exception represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Medium",
        "question": "Which block normally executes whether an exception occurs or not?",
        "options": [
            "finally",
            "final",
            "default",
            "else"
        ],
        "correctAnswer": "finally",
        "hint": "Focus on the Java mechanism used for the specific runtime task mentioned.",
        "explanation": "Correct answer: finally.\nThe key idea is: It is commonly used for cleanup operations.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as final, default, else represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Medium",
        "question": "Which collection maintains insertion order and allows duplicates?",
        "options": [
            "ArrayList",
            "HashSet",
            "TreeSet",
            "HashMap"
        ],
        "correctAnswer": "ArrayList",
        "hint": "Compare the collection characteristics such as ordering, uniqueness, and key-value storage.",
        "explanation": "Correct answer: ArrayList.\nThe key idea is: Think of a resizable ordered list.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as HashSet, TreeSet, HashMap represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Hard",
        "question": "Which collection stores elements in sorted order?",
        "options": [
            "HashSet",
            "TreeSet",
            "ArrayList",
            "LinkedHashSet"
        ],
        "correctAnswer": "TreeSet",
        "hint": "Compare the collection characteristics such as ordering, uniqueness, and key-value storage.",
        "explanation": "Correct answer: TreeSet.\nThe key idea is: The name gives a clue about ordering.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as HashSet, ArrayList, LinkedHashSet represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Hard",
        "question": "Which interface is the root of the Java collection hierarchy for groups of objects?",
        "options": [
            "Collection",
            "IterableOnly",
            "ObjectList",
            "Group"
        ],
        "correctAnswer": "Collection",
        "hint": "Compare the collection characteristics such as ordering, uniqueness, and key-value storage.",
        "explanation": "Correct answer: Collection.\nThe key idea is: It represents a general group of objects.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as IterableOnly, ObjectList, Group represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Hard",
        "question": "What does JVM stand for?",
        "options": [
            "Java Virtual Machine",
            "Java Variable Method",
            "Java Verified Machine",
            "Java Visual Model"
        ],
        "correctAnswer": "Java Virtual Machine",
        "hint": "Focus on the Java language rule being tested and eliminate options that are not valid Java constructs.",
        "explanation": "Correct answer: Java Virtual Machine.\nThe key idea is: It is the runtime environment for Java bytecode.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as Java Variable Method, Java Verified Machine, Java Visual Model represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "Java",
        "difficulty": "Hard",
        "question": "Which keyword is used when a class implements an interface?",
        "options": [
            "extends",
            "implements",
            "interface",
            "inherits"
        ],
        "correctAnswer": "implements",
        "hint": "Look at the purpose of each Java keyword or modifier before selecting one.",
        "explanation": "Correct answer: implements.\nThe key idea is: Classes use this keyword to provide interface behavior.\nThis question tests Java’s syntax, type system, object model, or standard library.\nThe correct choice fits the exact role described in the question; the other choices do not satisfy that role.\nFor comparison, options such as extends, interface, inherits represent different Java concepts or purposes.\nFor exams, remember the purpose of the construct first; the name is much easier to recall after that."
    },
    {
        "category": "C",
        "difficulty": "Easy",
        "question": "Which data type is commonly used to store a single character in C?",
        "options": [
            "char",
            "string",
            "text",
            "character"
        ],
        "correctAnswer": "char",
        "hint": "Focus on the C syntax, memory rule, or standard-library role described by the question.",
        "explanation": "Correct answer: char.\nThe key idea is: C uses a character data type for one character.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as string, text, character, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Easy",
        "question": "Which operator gives the remainder after integer division?",
        "options": [
            "%",
            "/",
            "//",
            "rem"
        ],
        "correctAnswer": "%",
        "hint": "Focus on the C syntax, memory rule, or standard-library role described by the question.",
        "explanation": "Correct answer: %.\nThe key idea is: It is called the modulo operator.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as /, //, rem, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Easy",
        "question": "Which statement is commonly used to choose between conditions?",
        "options": [
            "if",
            "switchonly",
            "choose",
            "when"
        ],
        "correctAnswer": "if",
        "hint": "Focus on the C syntax, memory rule, or standard-library role described by the question.",
        "explanation": "Correct answer: if.\nThe key idea is: It evaluates a condition before executing a block.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as switchonly, choose, when, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Medium",
        "question": "Which loop is best suited when the number of iterations is known?",
        "options": [
            "for",
            "whileonly",
            "do",
            "repeat"
        ],
        "correctAnswer": "for",
        "hint": "Check when the condition is tested and how control moves to the next iteration.",
        "explanation": "Correct answer: for.\nThe key idea is: Its structure includes initialization, condition and update.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as whileonly, do, repeat, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Medium",
        "question": "Which keyword exits a loop immediately?",
        "options": [
            "break",
            "stop",
            "exitloop",
            "returnall"
        ],
        "correctAnswer": "break",
        "hint": "Check when the condition is tested and how control moves to the next iteration.",
        "explanation": "Correct answer: break.\nThe key idea is: It transfers control outside the loop.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as stop, exitloop, returnall, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Medium",
        "question": "Which keyword skips the current loop iteration?",
        "options": [
            "continue",
            "skip",
            "next",
            "pass"
        ],
        "correctAnswer": "continue",
        "hint": "Check when the condition is tested and how control moves to the next iteration.",
        "explanation": "Correct answer: continue.\nThe key idea is: It jumps to the next iteration.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as skip, next, pass, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Medium",
        "question": "What is the index of the first element in a C array?",
        "options": [
            "0",
            "1",
            "-1",
            "Depends on compiler"
        ],
        "correctAnswer": "0",
        "hint": "Focus on the C syntax, memory rule, or standard-library role described by the question.",
        "explanation": "Correct answer: 0.\nThe key idea is: C arrays use zero-based indexing.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as 1, -1, Depends on compiler, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Hard",
        "question": "Which operator has the highest relevance when declaring a pointer variable?",
        "options": [
            "*",
            "&",
            "->",
            "%"
        ],
        "correctAnswer": "*",
        "hint": "Distinguish between an address, a pointer, and the value stored at that address.",
        "explanation": "Correct answer: *.\nThe key idea is: It is placed with the pointer declaration.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as &, ->, %, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Hard",
        "question": "Which function is commonly used to allocate zero-initialized memory for an array?",
        "options": [
            "calloc()",
            "malloc()",
            "alloczero()",
            "memset()"
        ],
        "correctAnswer": "calloc()",
        "hint": "Focus on when memory is obtained, used, and released during program execution.",
        "explanation": "Correct answer: calloc().\nThe key idea is: Its name combines contiguous allocation with initialization.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as malloc(), alloczero(), memset(), are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "C",
        "difficulty": "Hard",
        "question": "Which preprocessor directive is used to include a header file?",
        "options": [
            "#include",
            "#header",
            "include()",
            "using"
        ],
        "correctAnswer": "#include",
        "hint": "Focus on the C syntax, memory rule, or standard-library role described by the question.",
        "explanation": "Correct answer: #include.\nThe key idea is: It begins with the hash symbol and names the header.\nThis question tests C’s procedural syntax, memory model, operators, or standard library.\nThe correct choice matches the specific language rule or programming operation being tested.\nThe other choices, such as #header, include(), using, are used for different purposes in C.\nFor exams, connect the construct with a small code example so the rule is easier to remember."
    },
    {
        "category": "Python",
        "difficulty": "Easy",
        "question": "Which data type stores an ordered sequence that can be changed?",
        "options": [
            "list",
            "tuple",
            "string",
            "set"
        ],
        "correctAnswer": "list",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: list.\nThe key idea is: It uses square brackets and is mutable.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives tuple, string, set have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Easy",
        "question": "Which data type stores unique unordered values?",
        "options": [
            "set",
            "list",
            "tuple",
            "string"
        ],
        "correctAnswer": "set",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: set.\nThe key idea is: Think of mathematical set behavior.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives list, tuple, string have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Easy",
        "question": "Which keyword is used to stop a loop completely?",
        "options": [
            "break",
            "stop",
            "exit",
            "end"
        ],
        "correctAnswer": "break",
        "hint": "Trace the iteration rule carefully, including the starting point and stopping condition.",
        "explanation": "Correct answer: break.\nThe key idea is: It immediately leaves the loop.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives stop, exit, end have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Easy",
        "question": "Which keyword skips to the next loop iteration?",
        "options": [
            "continue",
            "skip",
            "next",
            "pass"
        ],
        "correctAnswer": "continue",
        "hint": "Trace the iteration rule carefully, including the starting point and stopping condition.",
        "explanation": "Correct answer: continue.\nThe key idea is: It does not end the loop; it moves to the next iteration.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives skip, next, pass have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Medium",
        "question": "Which keyword is used to create an iterator loop over items?",
        "options": [
            "for",
            "loop",
            "iterate",
            "each"
        ],
        "correctAnswer": "for",
        "hint": "Trace the iteration rule carefully, including the starting point and stopping condition.",
        "explanation": "Correct answer: for.\nThe key idea is: It is the standard sequence-iteration keyword.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives loop, iterate, each have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Medium",
        "question": "Which function returns the largest value from a sequence?",
        "options": [
            "max()",
            "largest()",
            "top()",
            "high()"
        ],
        "correctAnswer": "max()",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: max().\nThe key idea is: It returns the greatest item.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives largest(), top(), high() have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Medium",
        "question": "Which function returns the smallest value from a sequence?",
        "options": [
            "min()",
            "smallest()",
            "low()",
            "least()"
        ],
        "correctAnswer": "min()",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: min().\nThe key idea is: It returns the least item.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives smallest(), low(), least() have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Hard",
        "question": "Which keyword is used to create a generator value one item at a time?",
        "options": [
            "yield",
            "generate",
            "returnmany",
            "nextvalue"
        ],
        "correctAnswer": "yield",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: yield.\nThe key idea is: It pauses a generator and produces a value.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives generate, returnmany, nextvalue have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Hard",
        "question": "Which special method initializes a newly created object?",
        "options": [
            "__init__()",
            "__start__()",
            "__newclass__()",
            "initiate()"
        ],
        "correctAnswer": "__init__()",
        "hint": "Focus on Python’s built-in behavior and the role of the construct named in the question.",
        "explanation": "Correct answer: __init__().\nThe key idea is: It is the common initializer in Python classes.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives __start__(), __newclass__(), initiate() have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Python",
        "difficulty": "Hard",
        "question": "Which operator checks whether two values are equal?",
        "options": [
            "==",
            "=",
            "===",
            "equals"
        ],
        "correctAnswer": "==",
        "hint": "Check the operator’s exact Python meaning rather than relying on its appearance.",
        "explanation": "Correct answer: ==.\nThe key idea is: A single equals sign is assignment.\nThis question tests Python’s built-in data model, syntax, operators, or runtime behavior.\nThe correct choice matches the exact behavior or language feature asked about.\nThe alternatives =, ===, equals have different meanings, data-model roles, or runtime behavior.\nFor exams, remember the behavior with a tiny example rather than memorizing the option alone."
    },
    {
        "category": "Aptitude",
        "difficulty": "Easy",
        "question": "What is 30% of 500?",
        "options": [
            "100",
            "150",
            "200",
            "250"
        ],
        "correctAnswer": "150",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 150.\nThe key idea is: Convert 30 percent into a fraction of 500.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 100, 200, 250, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Easy",
        "question": "What is the HCF of 18 and 24?",
        "options": [
            "3",
            "6",
            "9",
            "12"
        ],
        "correctAnswer": "6",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 6.\nThe key idea is: List the common factors of both numbers.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 3, 9, 12, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Easy",
        "question": "What is the LCM of 6 and 8?",
        "options": [
            "12",
            "18",
            "24",
            "48"
        ],
        "correctAnswer": "24",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 24.\nThe key idea is: Find the smallest positive common multiple.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 12, 18, 48, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Medium",
        "question": "If the ratio of boys to girls is 3:2 and there are 25 students, how many are boys?",
        "options": [
            "10",
            "12",
            "15",
            "18"
        ],
        "correctAnswer": "15",
        "hint": "Reduce the relationship to a common scale before comparing the quantities.",
        "explanation": "Correct answer: 15.\nThe key idea is: There are five equal ratio parts.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 10, 12, 18, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Medium",
        "question": "A shopkeeper buys an item for ₹600 and gives a 10% discount on a marked price of ₹800. What is the selling price?",
        "options": [
            "₹680",
            "₹700",
            "₹720",
            "₹760"
        ],
        "correctAnswer": "₹720",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: ₹720.\nThe key idea is: Find ten percent of the marked price and subtract it.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including ₹680, ₹700, ₹760, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Medium",
        "question": "A can complete a job in 12 days and B in 6 days. How many days together?",
        "options": [
            "3",
            "4",
            "6",
            "9"
        ],
        "correctAnswer": "4",
        "hint": "Think in terms of total work and worker-days rather than only the number of people.",
        "explanation": "Correct answer: 4.\nThe key idea is: Add their daily work rates.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 3, 6, 9, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Hard",
        "question": "A man walks at 5 km/h. How long does he take to cover 15 km?",
        "options": [
            "2 hours",
            "3 hours",
            "4 hours",
            "5 hours"
        ],
        "correctAnswer": "3 hours",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 3 hours.\nThe key idea is: Time equals distance divided by speed.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 2 hours, 4 hours, 5 hours, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Hard",
        "question": "What is the compound interest on ₹1000 at 10% per year for 2 years?",
        "options": [
            "₹200",
            "₹210",
            "₹220",
            "₹250"
        ],
        "correctAnswer": "₹210",
        "hint": "Identify principal, rate, and time, then use the standard interest relationship.",
        "explanation": "Correct answer: ₹210.\nThe key idea is: Apply the percentage for two successive years.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including ₹200, ₹220, ₹250, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Hard",
        "question": "A bag has 3 red and 2 blue balls. What is the probability of drawing a red ball?",
        "options": [
            "2/5",
            "3/5",
            "1/2",
            "4/5"
        ],
        "correctAnswer": "3/5",
        "hint": "Break the calculation into small steps and check the units before choosing an option.",
        "explanation": "Correct answer: 3/5.\nThe key idea is: Probability is favorable outcomes divided by total outcomes.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 2/5, 1/2, 4/5, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "Aptitude",
        "difficulty": "Hard",
        "question": "If the average of five numbers is 18, what is their total?",
        "options": [
            "72",
            "80",
            "90",
            "100"
        ],
        "correctAnswer": "90",
        "hint": "Use the definition of average and work backward or forward as required.",
        "explanation": "Correct answer: 90.\nThe key idea is: Multiply the average by the number of values.\nThis question tests the mathematical relationship represented by the quantities in the question.\nThe correct choice is obtained by applying that relationship to the values given in the problem.\nThe other choices, including 72, 80, 100, come from using a different relationship or arithmetic step.\nFor exams, write the formula first, substitute second, and check the final value before selecting an option."
    },
    {
        "category": "GK",
        "difficulty": "Easy",
        "question": "Which is the largest state in India by area?",
        "options": [
            "Maharashtra",
            "Rajasthan",
            "Madhya Pradesh",
            "Uttar Pradesh"
        ],
        "correctAnswer": "Rajasthan",
        "hint": "Recall the standard fact connected with the person, place, term, event, or object in the question.",
        "explanation": "Correct answer: Rajasthan.\nThe key idea is: Think of the state with the largest geographical area.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Maharashtra, Madhya Pradesh, Uttar Pradesh are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Easy",
        "question": "Which is the currency of Japan?",
        "options": [
            "Won",
            "Yen",
            "Yuan",
            "Ringgit"
        ],
        "correctAnswer": "Yen",
        "hint": "Recall the standard fact connected with the person, place, term, event, or object in the question.",
        "explanation": "Correct answer: Yen.\nThe key idea is: It is the Japanese currency symbolized by ¥.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Won, Yuan, Ringgit are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Easy",
        "question": "Which planet is closest to the Sun?",
        "options": [
            "Venus",
            "Mercury",
            "Earth",
            "Mars"
        ],
        "correctAnswer": "Mercury",
        "hint": "Match the defining property in the question with the correct standard fact.",
        "explanation": "Correct answer: Mercury.\nThe key idea is: It has the smallest orbital distance from the Sun.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Venus, Earth, Mars are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Medium",
        "question": "Which instrument is used to measure atmospheric pressure?",
        "options": [
            "Thermometer",
            "Barometer",
            "Hygrometer",
            "Ammeter"
        ],
        "correctAnswer": "Barometer",
        "hint": "Recall the standard fact connected with the person, place, term, event, or object in the question.",
        "explanation": "Correct answer: Barometer.\nThe key idea is: Its name is associated with pressure measurement.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Thermometer, Hygrometer, Ammeter are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Medium",
        "question": "Which is the largest mammal on Earth?",
        "options": [
            "Elephant",
            "Blue whale",
            "Giraffe",
            "Hippopotamus"
        ],
        "correctAnswer": "Blue whale",
        "hint": "Recall the standard fact connected with the person, place, term, event, or object in the question.",
        "explanation": "Correct answer: Blue whale.\nThe key idea is: It is the largest animal known to have lived.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Elephant, Giraffe, Hippopotamus are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Medium",
        "question": "Which Indian city is known as the Pink City?",
        "options": [
            "Jaipur",
            "Jodhpur",
            "Udaipur",
            "Bikaner"
        ],
        "correctAnswer": "Jaipur",
        "hint": "Recall the standard fact connected with the person, place, term, event, or object in the question.",
        "explanation": "Correct answer: Jaipur.\nThe key idea is: Its historic city color gives the clue.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Jodhpur, Udaipur, Bikaner are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Hard",
        "question": "Which branch of government interprets laws and the Constitution?",
        "options": [
            "Executive",
            "Legislature",
            "Judiciary",
            "Election Commission"
        ],
        "correctAnswer": "Judiciary",
        "hint": "Recall the standard fact connected with the person, place, term, event, or object in the question.",
        "explanation": "Correct answer: Judiciary.\nThe key idea is: Courts perform this constitutional function.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Executive, Legislature, Election Commission are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Hard",
        "question": "Which layer of the atmosphere contains most weather phenomena?",
        "options": [
            "Stratosphere",
            "Troposphere",
            "Mesosphere",
            "Thermosphere"
        ],
        "correctAnswer": "Troposphere",
        "hint": "Recall the standard fact connected with the person, place, term, event, or object in the question.",
        "explanation": "Correct answer: Troposphere.\nThe key idea is: It is the lowest major atmospheric layer.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Stratosphere, Mesosphere, Thermosphere are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Hard",
        "question": "Who formulated the laws of motion?",
        "options": [
            "Albert Einstein",
            "Isaac Newton",
            "Galileo Galilei",
            "Nikola Tesla"
        ],
        "correctAnswer": "Isaac Newton",
        "hint": "Think of the person most directly associated with the named contribution.",
        "explanation": "Correct answer: Isaac Newton.\nThe key idea is: These laws are central to classical mechanics.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Albert Einstein, Galileo Galilei, Nikola Tesla are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    },
    {
        "category": "GK",
        "difficulty": "Hard",
        "question": "Which vitamin is mainly produced in the skin in response to sunlight?",
        "options": [
            "Vitamin A",
            "Vitamin B12",
            "Vitamin C",
            "Vitamin D"
        ],
        "correctAnswer": "Vitamin D",
        "hint": "Match the defining property in the question with the correct standard fact.",
        "explanation": "Correct answer: Vitamin D.\nThe key idea is: Sunlight helps the body synthesize this vitamin.\nThis question tests the standard fact or definition associated with the topic.\nThe correct choice matches the established fact being tested in the question.\nThe alternatives Vitamin A, Vitamin B12, Vitamin C are related facts or distractors, but they do not match the specific clue in the question.\nFor exams, connect this fact with its most distinctive name, place, date, or property."
    }
];

function parseQuestionText(text, category) {

    const questions = [];

    const lines = text.split(/\r?\n/);

    lines.forEach(line => {

        line = line.trim();

        if (!line) {
            return;
        }

        const data = line.split("|");

        // 10 fields:
        // category | difficulty | question | option1 | option2 | option3 | option4 | correct | hint | explanation
        if (data.length !== 10) {
            return;
        }

        if (data[0].trim().toLowerCase() !== category.trim().toLowerCase()) {
            return;
        }

        questions.push({
            category: data[0].trim(),
            difficulty: data[1].trim(),
            question: data[2].trim(),
            options: [
                data[3].trim(),
                data[4].trim(),
                data[5].trim(),
                data[6].trim()
            ],
            correctAnswer: data[7].trim(),
            hint: data[8].trim(),
            explanation: data[9].trim()
        });
    });

    shuffleArray(questions);
    return questions;
}

async function loadQuestions(category) {

    // First try questions.txt. This is the normal web-server path.
    try {
        const response = await fetch("questions.txt", { cache: "no-store" });

        if (response.ok) {
            const text = await response.text();
            const questions = parseQuestionText(text, category);

            if (questions.length > 0) {
                return questions;
            }

            console.warn("questions.txt loaded, but no matching questions were found for:", category);
        }
    } catch (error) {
        // A direct file:// launch commonly reaches here because browsers
        // block fetch() of local files. Use the built-in question bank below.
        console.warn("Could not fetch questions.txt; using built-in question bank.", error);
    }

    // Fallback for direct opening of index.html.
    const fallback = BUILTIN_QUESTIONS
        .filter(q => q.category.trim().toLowerCase() === category.trim().toLowerCase())
        .map(q => ({
            category: q.category,
            difficulty: q.difficulty,
            question: q.question,
            options: [...q.options],
            correctAnswer: q.correctAnswer,
            hint: q.hint,
            explanation: q.explanation
        }));

    shuffleArray(fallback);
    return fallback;
}


function shuffleArray(array) {

    for (
        let i = array.length - 1;
        i > 0;
        i--
    ) {

        const j = Math.floor(
            Math.random() * (i + 1)
        );

        [
            array[i],
            array[j]
        ] = [
            array[j],
            array[i]
        ];
    }

    return array;
}


// ============================================================
// APPLICATION START
// ============================================================

function otpConfigured() {
    return supabaseReady;
}

function showLogin() {
    stopTimer();
    currentPlayer = null;
    currentQuiz = null;

    document.getElementById("app").innerHTML = `
        <div class="page auth-page">
            <div class="container auth-container">
                <div class="card auth-card">
                    <div class="title">QuizMaster Pro</div>
                    <div class="subtitle">Secure signup/login with email OTP</div>

                    <div class="auth-tabs">
                        <button id="signupTab" class="auth-tab active" onclick="showAuthMode('signup')">Sign Up</button>
                        <button id="loginTab" class="auth-tab" onclick="showAuthMode('login')">Login</button>
                    </div>

                    <div id="authPanel"></div>

                    <div id="authStatus" class="auth-status"></div>
                </div>
            </div>
        </div>
    `;

    showAuthMode("signup");
}

function showAuthMode(mode) {
    authFlow = { mode, email: "", name: "" };

    document.getElementById("signupTab")?.classList.toggle("active", mode === "signup");
    document.getElementById("loginTab")?.classList.toggle("active", mode === "login");

    const panel = document.getElementById("authPanel");
    if (!panel) return;

    const setupNote = !otpConfigured() ? `
        <div class="setup-warning">
            <strong>One-time setup required</strong><br>
            Edit <code>supabase-config.js</code> with your Supabase Project URL and anon public key, then enable Email OTP in Supabase.
            The signup/login form is ready; OTP sending will work after this setup.
        </div>
    ` : "";

    if (mode === "signup") {
        panel.innerHTML = `${setupNote}
            <label class="input-label">Name</label>
            <input id="signupName" class="text-input" type="text" placeholder="Enter your full name" autocomplete="name">

            <label class="input-label">Mail ID</label>
            <div class="otp-row">
                <input id="signupEmail" class="text-input" type="email" placeholder="you@example.com" autocomplete="email">
<button class="btn btn-secondary otp-send-btn" onclick="sendSignupOtp()">Send OTP</button>            </div>

            <label class="input-label">Enter OTP</label>
<input id="signupOtp" class="text-input" type="text" inputmode="numeric" maxlength="8" placeholder="8-digit OTP" autocomplete="one-time-code">
            <button class="btn btn-success" onclick="completeSignup()">Sign Up ✓</button>
            <div class="auth-help">Enter your email, click Send OTP, then enter the code received in your email.</div>
        `;
    } else {
        panel.innerHTML = `${setupNote}
            <label class="input-label">Mail ID</label>
            <div class="otp-row">
                <input id="loginEmail" class="text-input" type="email" placeholder="you@example.com" autocomplete="email">
                <button class="btn btn-secondary otp-send-btn" onclick="sendLoginOtp()">Send OTP</button>
            </div>

            <label class="input-label">Enter OTP</label>
            <input id="loginOtp" class="text-input" type="text" inputmode="numeric" maxlength="8" placeholder="8-digit OTP" autocomplete="one-time-code">

            <div class="or-divider"><span>OR</span></div>

            <label class="input-label">Registration ID</label>
            <input id="loginRegistrationId" class="text-input" type="text" placeholder="Example: QMP-7A3F91C2" autocomplete="off">

            <button class="btn btn-primary" onclick="completeLogin()">Login →</button>
            <div class="auth-help">Login with either the OTP sent to your email or your Registration ID.</div>
        `;
    }
}

function setAuthStatus(message, type = "info") {
    const element = document.getElementById("authStatus");
    if (!element) return;
    element.textContent = message;
    element.className = `auth-status ${type}`;
}

function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendSignupOtp() {
    if (!otpConfigured()) {
        setAuthStatus("Configure Supabase in supabase-config.js first.", "error");
        return;
    }
    const name = document.getElementById("signupName")?.value.trim();
    const email = document.getElementById("signupEmail")?.value.trim().toLowerCase();

    if (!name) {
        setAuthStatus("Enter your name first.", "error");
        return;
    }
    if (!validateEmail(email)) {
        setAuthStatus("Enter a valid email address.", "error");
        return;
    }

    try {
        setAuthStatus("Sending OTP...", "info");
        const { error } = await supabaseClient.auth.signInWithOtp({
            email,
            options: {
                shouldCreateUser: true,
                data: { name }
            }
        });
        if (error) throw error;
        authFlow.email = email;
        authFlow.name = name;
setAuthStatus("✓ OTP sent successfully. Check your email and enter the 8-digit code.", "success");    } catch (error) {
        console.error(error);
        setAuthStatus(error.message || "Could not send OTP.", "error");
    }
}

async function sendLoginOtp() {
    if (!otpConfigured()) {
        setAuthStatus("Configure Supabase in supabase-config.js first.", "error");
        return;
    }
    const email = document.getElementById("loginEmail")?.value.trim().toLowerCase();
    if (!validateEmail(email)) {
        setAuthStatus("Enter a valid email address.", "error");
        return;
    }

    try {
        setAuthStatus("Sending OTP...", "info");
        const { error } = await supabaseClient.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: false }
        });
        if (error) throw error;
        authFlow.email = email;
setAuthStatus("OTP sent. Check your email and enter the 8-digit code.", "success");    } catch (error) {
        console.error(error);
        setAuthStatus(error.message || "Could not send OTP. Make sure this email is registered.", "error");
    }
}

async function completeSignup() {
    if (!otpConfigured()) {
        setAuthStatus("Configure Supabase in supabase-config.js first.", "error");
        return;
    }
    const name = document.getElementById("signupName")?.value.trim();
    const email = document.getElementById("signupEmail")?.value.trim().toLowerCase();
    const token = document.getElementById("signupOtp")?.value.trim();

    if (!name || !validateEmail(email) || !/^\d{8}$/.test(token)) {
        setAuthStatus("Enter your name, valid email, and 8-digit OTP.", "error");
        return;
    }

    try {
        setAuthStatus("Verifying OTP...", "info");
        const { data, error } = await supabaseClient.auth.verifyOtp({
    email,
    token,
    type: "email"
});

if (error) throw error;

if (!data.user || !data.session) {
    throw new Error("OTP verified, but login session was not created.");
}

// Make absolutely sure the verified session is active
const { error: sessionError } = await supabaseClient.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token
});

if (sessionError) throw sessionError;

console.log("AUTHENTICATED USER:", data.user.id);
console.log("VERIFIED USER:", data.user.id);
console.log("SESSION:", data.session);
        const existingRemote = await getRemoteProfileByAuthId(data.user.id);
        if (existingRemote) {
            setAuthStatus("This email is already registered. Use Login instead.", "error");
            await supabaseClient.auth.signOut();
            return;
        }

        const registrationId = await createRemoteProfile(data.user.id, name, email);
        registerProfile(name, email, registrationId);
        await registerUser(name, email, registrationId);
        currentPlayer = name;
        setAuthStatus("Signup successful.", "success");
        showHome();
    } catch (error) {
        console.error(error);
        setAuthStatus(error.message || "Invalid OTP.", "error");
    }
}

async function completeLogin() {
    if (!otpConfigured()) {
        setAuthStatus("Configure Supabase in supabase-config.js first.", "error");
        return;
    }
    const email = document.getElementById("loginEmail")?.value.trim().toLowerCase();
    const token = document.getElementById("loginOtp")?.value.trim();
    const registrationId = document.getElementById("loginRegistrationId")?.value.trim().toUpperCase();

    try {
        if (email && token) {
            if (!validateEmail(email) || !/^\d{8}$/.test(token)) {
                setAuthStatus("Enter a valid email and 8-digit OTP.", "error");
                return;
            }

            setAuthStatus("Verifying OTP...", "info");
            const { data, error } = await supabaseClient.auth.verifyOtp({
                email,
                token,
                type: "email"
            });
            if (error) throw error;
            if (!data.user) throw new Error("Login failed.");

            const profile = await getRemoteProfileByAuthId(data.user.id);
            if (!profile) throw new Error("Profile not found. Please sign up first.");
            await loginWithRemoteProfile(profile);
            return;
        }

        if (registrationId) {
            setAuthStatus("Checking Registration ID...", "info");
            const profile = await getRemoteProfileByRegistrationId(registrationId);
            if (!profile) throw new Error("Registration ID not found.");

            // Registration-ID login is allowed by the requested project flow.
            // It identifies the profile; OTP remains the recommended login method.
            await loginWithRemoteProfile(profile);
            return;
        }

        setAuthStatus("Enter an email + OTP, or a Registration ID.", "error");
    } catch (error) {
        console.error(error);
        setAuthStatus(error.message || "Login failed.", "error");
    }
}

async function createRemoteProfile(authId, name, email) {
    const { data, error } = await supabaseClient
        .from("profiles")
        .select("registration_id")
        .eq("id", authId)
        .maybeSingle();

    if (error) throw error;

    if (!data) {
        throw new Error("Profile was not created automatically.");
    }

    return data.registration_id;
}

async function getRemoteProfileByAuthId(authId) {
    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id,name,email,registration_id,registered_at")
        .eq("id", authId)
        .maybeSingle();
    if (error) throw error;
    return data;
}

async function getRemoteProfileByRegistrationId(registrationId) {
    const { data, error } = await supabaseClient
        .rpc("get_profile_by_registration_id", { p_registration_id: registrationId });
    if (error) throw error;
    return Array.isArray(data) ? data[0] || null : data || null;
}

async function loginWithRemoteProfile(profile) {
    const name = profile.name;
    const email = profile.email || "";
    const registrationId = profile.registration_id;

    registerProfile(name, email, registrationId);
    currentPlayer = name;
    showHome();
}

async function startApplication() {
    // Kept for backward compatibility with older bookmarks/files.
    showAuthMode("signup");
}

// ============================================================
// HOME
// ============================================================

function showHome() {

    stopTimer();

    document.getElementById("app").innerHTML = `

        <div class="page">

            <div class="container home-container">

                <div class="card">

                    <div class="title">
                        QuizMaster Pro
                    </div>

                    <div class="welcome">
                        Welcome, ${escapeHtml(currentPlayer)}
                    </div>

                    <div class="user-count">
                        👥 Registered Users :
                        <span id="registeredCount">${getUserCount()}</span>
                    </div>

                    <div class="home-buttons">

                        <button
                            class="btn btn-primary"
                            onclick="startQuiz('Java')"
                        >
                            ☕ Java
                        </button>

                        <button
                            class="btn btn-secondary"
                            onclick="startQuiz('C')"
                        >
                            💻 C
                        </button>

                        <button
                            class="btn btn-warning"
                            onclick="startQuiz('Python')"
                        >
                            🐍 Python
                        </button>

                        <button
                            class="btn btn-purple"
                            onclick="startQuiz('Aptitude')"
                        >
                            🧠 Aptitude
                        </button>

                        <button
                            class="btn btn-success"
                            onclick="startQuiz('GK')"
                        >
                            🌍 General Knowledge
                        </button>

                        <button
                            class="btn btn-dark"
                            onclick="showLeaderboard()"
                        >
                            🏆 Leaderboard
                        </button>

                        <button
                            class="btn btn-secondary"
                            onclick="showProfile()"
                        >
                            👤 My Profile
                        </button>

                        <button
                            class="btn btn-danger"
                            onclick="exitApplication()"
                        >
                            ❌ Exit
                        </button>

                    </div>

                </div>

            </div>

        </div>
    `;

    listenRegisteredUserCount();
}


// ============================================================
// QUIZ START
// ============================================================

async function startQuiz(category) {

    stopTimer();

    document.getElementById("app").innerHTML = `

        <div class="page">

            <div class="container quiz-container">

                <div class="card">

                    <div class="title">
                        Loading Quiz...
                    </div>

                    <div class="subtitle">
                        Loading questions for
                        ${escapeHtml(category)}
                    </div>

                </div>

            </div>

        </div>
    `;

    const questions =
        await loadQuestions(category);

    if (questions.length === 0) {

        alert(
            "No questions found for this category."
        );

        showHome();

        return;
    }

    currentQuiz = {

        playerName: currentPlayer,

        category: category,

        questions: questions,

        currentQuestion: 0,

        timeLeft: 30,
        answerChecked: false,
        selectedAnswer: null,
        isCorrect: false,

        score: 0,

        correct: 0,

        wrong: 0,

        skipped: 0,

        // Gate-style question palette state.
        questionStatus: Array(questions.length).fill("unanswered"),
        selectedAnswers: Array(questions.length).fill(null)
    };

    renderQuizQuestion();
}


// ============================================================
// PROGRESS
// ============================================================

function getProgressPercentage() {

    if (
        !currentQuiz ||
        currentQuiz.questions.length === 0
    ) {
        return 0;
    }

    return (
        (
            (currentQuiz.currentQuestion + 1) /
            currentQuiz.questions.length
        ) * 100
    );
}


// ============================================================
// SHOW QUESTION
// ============================================================

function renderQuizQuestion() {

    stopTimer();

    const quiz = currentQuiz;

    if (!quiz) {
        return;
    }

    if (
        quiz.currentQuestion >=
        quiz.questions.length
    ) {

        confirmSubmitAfterLastQuestion();
        return;
    }

    const q = quiz.questions[quiz.currentQuestion];

    // Reset only the temporary feedback state for the question being shown.
    quiz.answerChecked = false;
    quiz.selectedAnswer = quiz.selectedAnswers[quiz.currentQuestion] || null;
    quiz.isCorrect = null;
    quiz.timeLeft = 30;

    const selectedAnswer = quiz.selectedAnswers[quiz.currentQuestion];
    const alreadyAnswered = quiz.questionStatus[quiz.currentQuestion] === "answered";

    document.getElementById("app").innerHTML = `

        <div class="page">

            <div class="container quiz-container quiz-layout">

                <aside class="question-palette card">
                    <div class="palette-title">Questions</div>
                    <div class="palette-legend">
                        <span><i class="legend-box current"></i> Current</span>
                        <span><i class="legend-box answered"></i> Attempted</span>
                        <span><i class="legend-box skipped"></i> Skipped</span>
                    </div>
                    <div class="question-boxes">
                        ${quiz.questionStatus.map((status, index) => `
                            <div
                                class="question-box ${status} ${index === quiz.currentQuestion ? "current" : ""}"
                                title="Question ${index + 1}"
                            >${index + 1}</div>
                        `).join("")}
                    </div>
                    <div class="attempt-count">
                        Attempted: <strong>${quiz.questionStatus.filter(status => status === "answered").length}</strong> / ${quiz.questions.length}
                    </div>
                </aside>

                <main class="card quiz-main-card">

                    <div class="quiz-top">

                        <div class="category-label">
                            Category : ${escapeHtml(quiz.category)}
                        </div>

                        <div
                            id="timer"
                            class="timer-circle"
                            style="--elapsed: 0%"
                            aria-label="30 seconds remaining"
                        >
                            <div class="timer-number" id="timerNumber">30</div>
                        </div>

                    </div>

                    <div class="progress-container">
                        <div
                            id="progressBar"
                            class="progress-bar"
                            style="width: ${getProgressPercentage()}%"
                        ></div>
                    </div>

                    <div class="quiz-info">
                        <span>
                            Question ${quiz.currentQuestion + 1} / ${quiz.questions.length}
                        </span>
                        <span id="score">Score : ${quiz.score}</span>
                    </div>

                    <div class="question">
                        ${escapeHtml(q.question)}
                    </div>

                    <div class="options">
                        ${createOption(q.options[0], 0)}
                        ${createOption(q.options[1], 1)}
                        ${createOption(q.options[2], 2)}
                        ${createOption(q.options[3], 3)}
                    </div>

                    <div id="answerFeedback" class="answer-feedback" aria-live="polite"></div>

                    <div class="quiz-actions">
                        <button
                            class="btn btn-warning hint-btn"
                            onclick="showHint()"
                            ${alreadyAnswered ? "disabled" : ""}
                        >
                            💡 Hint
                        </button>

                        <button
                            id="skipButton"
                            class="btn btn-secondary skip-btn"
                            onclick="skipQuestion()"
                            ${alreadyAnswered ? "disabled" : ""}
                        >
                            ⏭ Skip
                        </button>

                        <button
                            id="nextButton"
                            class="btn btn-primary next-btn"
                            onclick="checkAnswer()"
                            disabled
                        >
                            ${
                                quiz.currentQuestion === quiz.questions.length - 1
                                    ? "Submit Quiz ✓"
                                    : "Next ➜"
                            }
                        </button>
                    </div>

                </main>

            </div>

        </div>
    `;

    setupOptionListeners();

    // A skipped/answered question is not restarted; normal questions get 30 seconds.
    if (alreadyAnswered) {
        restoreAnsweredQuestion();
    } else {
        startTimer();
    }
}

function restoreAnsweredQuestion() {
    const quiz = currentQuiz;
    const q = quiz.questions[quiz.currentQuestion];
    const selectedAnswer = quiz.selectedAnswers[quiz.currentQuestion];

    document.querySelectorAll('input[name="quizOption"]').forEach(input => {
        input.disabled = true;
        if (input.value === selectedAnswer) {
            input.checked = true;
            input.closest(".option").classList.add("selected");
        }
    });

    const isCorrect = selectedAnswer === q.correctAnswer;
    const feedback = document.getElementById("answerFeedback");
    if (feedback) {
        feedback.className = `answer-feedback ${isCorrect ? "correct" : "wrong"}`;
        feedback.innerHTML = buildFeedbackHtml(q, selectedAnswer, isCorrect);
    }

    const button = document.getElementById("nextButton");
    if (button) button.disabled = false;
}

function buildFeedbackHtml(q, selectedAnswer, isCorrect) {
    const selectedText = escapeHtml(selectedAnswer || "Not answered");
    const correctText = escapeHtml(q.correctAnswer);
    const explanationText = escapeHtml(q.explanation || "Review the concept carefully.");

    return `
        <div class="feedback-title">
            ${isCorrect ? "✓ Correct!" : "✗ Wrong!"}
        </div>
        ${!isCorrect ? `
            <div class="feedback-answer">
                <strong>Your answer:</strong> ${selectedText}<br>
                <strong>Correct answer:</strong> ${correctText}
            </div>
        ` : ""}
        <div class="feedback-explanation">
            <strong>Explanation:</strong><br>
            ${explanationText.replace(/\n/g, "<br>")}
        </div>
    `;
}

function createOption(option, index) {

    return `

        <label
            class="option"
            id="option-${index}"
        >

            <input
                type="radio"
                name="quizOption"
                value="${escapeHtml(option)}"
                onchange="selectOption(${index})"
            >

            <span>
                ${escapeHtml(option)}
            </span>

        </label>
    `;
}

function setupOptionListeners() {

    const options =
        document.querySelectorAll(
            'input[name="quizOption"]'
        );

    options.forEach(input => {

        input.addEventListener(
            "change",
            function() {

                document
                    .querySelectorAll(".option")
                    .forEach(option => {

                        option.classList.remove(
                            "selected"
                        );

                    });

                this.closest(".option")
                    .classList.add("selected");
            }
        );
    });
}

function selectOption(index) {

    if (!currentQuiz || currentQuiz.answerChecked) {
        return;
    }

    const button = document.getElementById("nextButton");
    if (button) button.disabled = false;

    evaluateCurrentAnswer();
}

function evaluateCurrentAnswer() {

    if (!currentQuiz || currentQuiz.answerChecked) {
        return;
    }

    const selected = document.querySelector('input[name="quizOption"]:checked');
    if (!selected) return;

    stopTimer();

    const quiz = currentQuiz;
    const q = quiz.questions[quiz.currentQuestion];
    const selectedAnswer = selected.value;
    const isCorrect = selectedAnswer === q.correctAnswer;

    quiz.answerChecked = true;
    quiz.selectedAnswer = selectedAnswer;
    quiz.isCorrect = isCorrect;
    quiz.selectedAnswers[quiz.currentQuestion] = selectedAnswer;
    quiz.questionStatus[quiz.currentQuestion] = "answered";

    if (isCorrect) {
        quiz.score += 5;
        quiz.correct++;
    } else {
        quiz.score -= 1;
        quiz.wrong++;
    }

    document.querySelectorAll('input[name="quizOption"]').forEach(input => {
        input.disabled = true;
    });

    document.querySelectorAll(".option").forEach(option => option.classList.remove("selected"));
    selected.closest(".option").classList.add("selected");

    const feedback = document.getElementById("answerFeedback");
    if (feedback) {
        feedback.className = `answer-feedback ${isCorrect ? "correct" : "wrong"}`;
        feedback.innerHTML = buildFeedbackHtml(q, selectedAnswer, isCorrect);
    }

    const button = document.getElementById("nextButton");
    if (button) {
        button.disabled = false;
        button.textContent =
            quiz.currentQuestion === quiz.questions.length - 1
                ? "Submit Quiz ✓"
                : "Next ➜";
    }

    const skipButton = document.getElementById("skipButton");
    if (skipButton) skipButton.disabled = true;

    const hintButton = document.querySelector(".hint-btn");
    if (hintButton) hintButton.disabled = true;

    updateLiveScore();
    updateQuestionPalette();
}

function skipQuestion() {

    if (!currentQuiz || currentQuiz.answerChecked) return;

    stopTimer();

    const quiz = currentQuiz;
    quiz.questionStatus[quiz.currentQuestion] = "skipped";
    quiz.selectedAnswers[quiz.currentQuestion] = null;
    quiz.skipped++;

    moveToNextQuestion();
}

function moveToNextQuestion() {

    if (!currentQuiz) return;

    if (currentQuiz.currentQuestion === currentQuiz.questions.length - 1) {
        confirmSubmitAfterLastQuestion();
        return;
    }

    currentQuiz.currentQuestion++;
    renderQuizQuestion();
}

function updateQuestionPalette() {
    if (!currentQuiz) return;

    document.querySelectorAll(".question-box").forEach((box, index) => {
        box.className = `question-box ${currentQuiz.questionStatus[index]} ${index === currentQuiz.currentQuestion ? "current" : ""}`;
    });

    const count = document.querySelector(".attempt-count strong");
    if (count) {
        count.textContent = currentQuiz.questionStatus.filter(status => status === "answered").length;
    }
}


// ============================================================
// TIMER
// ============================================================

function startTimer() {

    stopTimer();

    if (!currentQuiz || currentQuiz.answerChecked) return;

    updateTimerDisplay();

    quizTimer = setInterval(() => {

        if (!currentQuiz || currentQuiz.answerChecked) {
            stopTimer();
            return;
        }

        currentQuiz.timeLeft--;
        updateTimerDisplay();

        if (currentQuiz.timeLeft <= 0) {
            stopTimer();
            handleTimeUp();
        }

    }, 1000);
}

function stopTimer() {
    if (quizTimer !== null) {
        clearInterval(quizTimer);
        quizTimer = null;
    }
}

function updateTimerDisplay() {

    const timer = document.getElementById("timer");
    const number = document.getElementById("timerNumber");

    if (!timer || !currentQuiz) return;

    const elapsed = Math.min(100, Math.max(0, ((30 - currentQuiz.timeLeft) / 30) * 100));
    timer.style.setProperty("--elapsed", `${elapsed}%`);

    if (currentQuiz.timeLeft <= 5) {
        timer.classList.add("danger");
    } else {
        timer.classList.remove("danger");
    }

    if (number) number.textContent = currentQuiz.timeLeft;
    timer.setAttribute("aria-label", `${currentQuiz.timeLeft} seconds remaining`);
}

function handleTimeUp() {

    if (!currentQuiz) return;

    const quiz = currentQuiz;
    quiz.questionStatus[quiz.currentQuestion] = "skipped";
    quiz.selectedAnswers[quiz.currentQuestion] = null;
    quiz.skipped++;

    // Show the completed red circle briefly before moving on.
    updateTimerDisplay();

    setTimeout(() => {
        if (!currentQuiz) return;
        moveToNextQuestion();
    }, 350);
}


// ============================================================
// HINT
// ============================================================

function showHint() {

    if (!currentQuiz) {
        return;
    }

    const q =
        currentQuiz.questions[
            currentQuiz.currentQuestion
        ];

    alert(`💡 Hint : ${q.hint}`);
}


// ============================================================
// CHECK ANSWER
// ============================================================

function checkAnswer() {

    if (!currentQuiz) return;

    // Selecting an option already evaluates it. This button only advances now.
    if (!currentQuiz.answerChecked) {
        evaluateCurrentAnswer();
        return;
    }

    if (currentQuiz.currentQuestion === currentQuiz.questions.length - 1) {
        const shouldSubmit = window.confirm("Are you sure you want to submit the quiz?");
        if (shouldSubmit) finishQuiz();
        return;
    }

    moveToNextQuestion();
}

function updateLiveScore() {

    const score =
        document.getElementById("score");

    if (score && currentQuiz) {

        score.textContent =
            `Score : ${currentQuiz.score}`;
    }
}

function confirmSubmitAfterLastQuestion() {

    stopTimer();

    const shouldSubmit =
        window.confirm(
            "Are you sure you want to submit the quiz?"
        );

    if (shouldSubmit) {

        finishQuiz();

    } else {

        currentQuiz.currentQuestion =
            currentQuiz.questions.length - 1;

        renderQuizQuestion();
    }
}


// ============================================================
// FINISH QUIZ
// ============================================================

function finishQuiz() {

    stopTimer();

    if (!currentQuiz) {
        return;
    }

    const quiz = currentQuiz;

    const total =
        quiz.correct +
        quiz.wrong +
        quiz.skipped;

    let accuracy = 0;

    if (total > 0) {

        accuracy =
            (quiz.correct * 100) /
            total;
    }

    let badge;

    if (accuracy >= 90) {

        badge = "Gold";

    } else if (accuracy >= 75) {

        badge = "Silver";

    } else if (accuracy >= 60) {

        badge = "Bronze";

    } else {

        badge = "Keep Practicing";
    }

    updateProfile(

        quiz.playerName,

        quiz.score,

        badge === "Keep Practicing"
            ? "None"
            : badge,

        accuracy
    );

    saveHistory(

        quiz.playerName,

        quiz.category,

        quiz.score,

        quiz.correct,

        quiz.wrong,

        quiz.skipped,

        accuracy,

        badge
    );

    showResult(
        quiz,
        accuracy,
        badge
    );
}


// ============================================================
// RESULT PAGE
// ============================================================

function showResult(
    quiz,
    accuracy,
    badge
) {

    let performanceMessage;

    if (accuracy >= 90) {

        performanceMessage =
            "🌟 Outstanding! You're a quiz champion!";

    } else if (accuracy >= 75) {

        performanceMessage =
            "👏 Great job! Keep up the excellent work!";

    } else if (accuracy >= 60) {

        performanceMessage =
            "👍 Good effort! You are improving!";

    } else {

        performanceMessage =
            "💪 Keep practicing. You can do better!";
    }

    const badgeDisplay =
        badge === "Gold"
            ? "🏆 Gold"
            : badge === "Silver"
                ? "🥈 Silver"
                : badge === "Bronze"
                    ? "🥉 Bronze"
                    : "📚 Keep Practicing";

    document.getElementById("app").innerHTML = `

        <div class="page">

            <div class="container result-container">

                <div class="card">

                    <div class="result-animation">
                        🎉 ✨
                    </div>

                    <div class="result-title">
                        QUIZ COMPLETED!
                    </div>

                    <div class="result-message">
                        Excellent work,
                        ${escapeHtml(quiz.playerName)}!
                    </div>

                    <div class="category-result">
                        Category :
                        ${escapeHtml(quiz.category)}
                    </div>

                    <div class="badge">
                        ${badgeDisplay}
                    </div>

                    <div class="result-cards">

                        <div class="result-card">

                            <div class="result-card-label">
                                SCORE
                            </div>

                            <div class="result-card-value">
                                ${quiz.score}
                            </div>

                        </div>

                        <div class="result-card">

                            <div class="result-card-label">
                                ACCURACY
                            </div>

                            <div class="result-card-value">
                                ${accuracy.toFixed(2)}%
                            </div>

                        </div>

                    </div>

                    <div class="stats">

                        <div class="stat">

                            <div class="stat-value">
                                ${quiz.correct}
                            </div>

                            <div class="stat-label">
                                Correct
                            </div>

                        </div>

                        <div class="stat">

                            <div class="stat-value">
                                ${quiz.wrong}
                            </div>

                            <div class="stat-label">
                                Wrong
                            </div>

                        </div>

                        <div class="stat">

                            <div class="stat-value">
                                ${quiz.skipped}
                            </div>

                            <div class="stat-label">
                                Skipped
                            </div>

                        </div>

                    </div>

                    <div class="performance">
                        ${performanceMessage}
                    </div>

                    <button
                        class="btn btn-primary"
                        onclick="startQuiz('${escapeJs(quiz.category)}')"
                    >
                        🔄 Play Again
                    </button>

                    <button
                        class="btn btn-success"
                        onclick="showHome()"
                    >
                        🏠 Home
                    </button>

                    <button
                        class="btn btn-danger"
                        onclick="exitApplication()"
                    >
                        ❌ Exit
                    </button>

                </div>

            </div>

        </div>
    `;
}


// ============================================================
// PROFILE
// ============================================================

function showProfile() {

    stopTimer();

    const profile =
        getProfile(currentPlayer);

    if (!profile) {

        alert("Profile not found.");

        showHome();

        return;
    }

    document.getElementById("app").innerHTML = `

        <div class="page">

            <div class="container profile-container">

                <div class="card">

                    <div class="title">
                        👤 USER PROFILE
                    </div>

                    <div class="profile-list">

                        <div class="profile-row">

                            <span class="profile-label">
                                👤 Name
                            </span>

                            <span class="profile-value">
                                ${escapeHtml(profile.name)}
                            </span>

                        </div>

                        <div class="profile-row">

                            <span class="profile-label">
                                🆔 User ID
                            </span>

                            <span class="profile-value">
                                ${profile.id}
                            </span>

                        </div>

                        <div class="profile-row">

                            <span class="profile-label">
                                📅 Registered
                            </span>

                            <span class="profile-value">
                                ${profile.registered}
                            </span>

                        </div>

                        <div class="profile-row">

                            <span class="profile-label">
                                📝 Total Quizzes
                            </span>

                            <span class="profile-value">
                                ${profile.totalQuizzes}
                            </span>

                        </div>

                        <div class="profile-row">

                            <span class="profile-label">
                                🏆 Highest Score
                            </span>

                            <span class="profile-value">
                                ${profile.highestScore}
                            </span>

                        </div>

                        <div class="profile-row">

                            <span class="profile-label">
                                🥇 Best Badge
                            </span>

                            <span class="profile-value">
                                ${getBadgeDisplay(profile.bestBadge)}
                            </span>

                        </div>

                        <div class="profile-row">

                            <span class="profile-label">
                                🎯 Average Accuracy
                            </span>

                            <span class="profile-value">
                                ${profile.averageAccuracy.toFixed(2)}%
                            </span>

                        </div>

                    </div>

                    <button
                        class="btn btn-secondary"
                        onclick="showHome()"
                    >
                        ← Close
                    </button>

                </div>

            </div>

        </div>
    `;
}

function getBadgeDisplay(badge) {

    if (badge === "Gold") {
        return "🏆 Gold";
    }

    if (badge === "Silver") {
        return "🥈 Silver";
    }

    if (badge === "Bronze") {
        return "🥉 Bronze";
    }

    return "None";
}


// ============================================================
// LEADERBOARD
// ============================================================

function showLeaderboard(category = "Java") {

    stopTimer();

    renderLeaderboard(category);
}

function renderLeaderboard(category) {

    const results =
        getLeaderboard(category);

    let tableContent = "";

    if (results.length === 0) {

        tableContent = `

            <div class="no-results">
                No quiz results yet
            </div>
        `;

    } else {

        tableContent = `

            <div class="table-wrapper">

                <table class="leaderboard-table">

                    <thead>

                        <tr>

                            <th>Rank</th>

                            <th>Player</th>

                            <th>Score</th>

                            <th>Accuracy</th>

                            <th>Achievement</th>

                        </tr>

                    </thead>

                    <tbody>

                        ${results.map(
                            (result, index) => {

                                const rank =
                                    index + 1;

                                let rankDisplay;

                                if (rank === 1) {

                                    rankDisplay = "🥇";

                                } else if (rank === 2) {

                                    rankDisplay = "🥈";

                                } else if (rank === 3) {

                                    rankDisplay = "🥉";

                                } else {

                                    rankDisplay = rank;
                                }

                                return `

                                    <tr>

                                        <td>
                                            ${rankDisplay}
                                        </td>

                                        <td>
                                            ${escapeHtml(
                                                result.player
                                            )}
                                        </td>

                                        <td>
                                            ${result.score}
                                        </td>

                                        <td>
                                            ${Number(
                                                result.accuracy
                                            ).toFixed(2)}%
                                        </td>

                                        <td>
                                            ${getBadgeDisplay(
                                                result.badge
                                            )}
                                        </td>

                                    </tr>
                                `;
                            }
                        ).join("")}

                    </tbody>

                </table>

            </div>
        `;
    }

    document.getElementById("app").innerHTML = `

        <div class="page">

            <div class="container leaderboard-container">

                <div class="card">

                    <div class="title">
                        🏆 LEADERBOARD
                    </div>

                    <div class="subtitle">
                        Compete with other players!
                    </div>

                    <label class="select-label">
                        Select Subject
                    </label>

                    <select
                        id="leaderboardCategory"
                        class="category-select"
                        onchange="renderLeaderboard(this.value)"
                    >

                        <option
                            value="Java"
                            ${category === "Java"
                                ? "selected"
                                : ""}
                        >
                            Java
                        </option>

                        <option
                            value="C"
                            ${category === "C"
                                ? "selected"
                                : ""}
                        >
                            C
                        </option>

                        <option
                            value="Python"
                            ${category === "Python"
                                ? "selected"
                                : ""}
                        >
                            Python
                        </option>

                        <option
                            value="Aptitude"
                            ${category === "Aptitude"
                                ? "selected"
                                : ""}
                        >
                            Aptitude
                        </option>

                        <option
                            value="GK"
                            ${category === "GK"
                                ? "selected"
                                : ""}
                        >
                            General Knowledge
                        </option>

                    </select>

                    ${tableContent}

                    <button
                        class="btn btn-secondary back-button"
                        onclick="showHome()"
                    >
                        ← Back
                    </button>

                </div>

            </div>

        </div>
    `;
}


// ============================================================
// EXIT
// ============================================================

function exitApplication() {

    stopTimer();

    if (registeredCountUnsubscribe) {
        registeredCountUnsubscribe();
        registeredCountUnsubscribe = null;
    }

    currentPlayer = null;

    currentQuiz = null;

    /*
       Browsers normally prevent JavaScript from closing
       tabs that were not opened by JavaScript.

       We therefore return to the login screen if the browser
       blocks window.close().
    */

    try {

        window.close();

    } catch (error) {

        console.log(
            "Browser prevented closing the tab."
        );
    }

    setTimeout(() => {

        showLogin();

    }, 100);
}


// ============================================================
// SECURITY / HTML HELPERS
// ============================================================

function escapeHtml(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value)

        .replace(/&/g, "&amp;")

        .replace(/</g, "&lt;")

        .replace(/>/g, "&gt;")

        .replace(/"/g, "&quot;")

        .replace(/'/g, "&#039;");
}

function escapeJs(value) {

    return String(value)

        .replace(/\\/g, "\\\\")

        .replace(/'/g, "\\'");
}


// ============================================================
// START APPLICATION
// ============================================================

showLogin();