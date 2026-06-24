/**
 * 초등학교 학급 월드컵 응원전 - 학생 페이지 전용 스크립트 (Vanilla JS + Firestore Realtime)
 */

import { db } from "./firebase.js";
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  limit, 
  serverTimestamp 
} from "firebase/firestore";

// --- Custom Firestore Error Handler following strict skill guidelines ---
function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
      email: null,
      emailVerified: null,
      isAnonymous: null,
      tenantId: null,
      providerInfo: []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Custom Toast System & Window Alert Interceptor ---
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'fixed bottom-5 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-full max-w-sm px-4 pointer-events-none';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'pointer-events-auto bg-slate-900/95 text-white backdrop-blur-md border border-slate-800 rounded-2xl px-5 py-3.5 text-xs font-bold shadow-2xl flex items-center justify-between gap-3 animate-in slide-in-from-bottom-4 fade-in duration-300';
  
  if (type === 'error') {
    toast.className = 'pointer-events-auto bg-rose-950/95 text-rose-200 backdrop-blur-md border border-rose-800/50 rounded-2xl px-5 py-3.5 text-xs font-bold shadow-2xl flex items-center justify-between gap-3 animate-in slide-in-from-bottom-4 fade-in duration-300';
  } else if (type === 'success') {
    toast.className = 'pointer-events-auto bg-emerald-950/95 text-emerald-200 backdrop-blur-md border border-emerald-800/50 rounded-2xl px-5 py-3.5 text-xs font-bold shadow-2xl flex items-center justify-between gap-3 animate-in slide-in-from-bottom-4 fade-in duration-300';
  }

  toast.innerHTML = `
    <span class="flex-1">${message}</span>
    <button class="text-slate-400 hover:text-white font-black text-sm cursor-pointer border-none bg-transparent ml-2 p-1" onclick="this.parentElement.remove()">×</button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

// Override standard alert globally
window.alert = function(message) {
  let type = 'info';
  const msg = (message ?? '').toString();
  if (msg.includes('실패') || msg.includes('오류') || msg.includes('않습니다') || msg.includes('없습니다') || msg.includes('바르게') || msg.includes('발견')) {
    type = 'error';
  } else if (msg.includes('완료') || msg.includes('성공') || msg.includes('복사') || msg.includes('가입') || msg.includes('입장') || msg.includes('참여')) {
    type = 'success';
  }
  showToast(msg, type);
};

// --- Safe Storage Wrapper to prevent iframe/sandboxed SecurityError ---
const safeStorage = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn("Storage access warning (getItem):", e);
      return null;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn("Storage access warning (setItem):", e);
    }
  },
  removeItem(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn("Storage access warning (removeItem):", e);
    }
  }
};

window.fetchCheeringData = function() {
  alert("현재 Firebase Firestore와 실시간 연동 중으로 자동 업데이트됩니다! ⚡");
};

const appState = {
  classCode: "",
  className: "",
  studentName: safeStorage.getItem("current_student_name") || "",
  isPredictSubmitting: false,
  isCheerSubmitting: false,
  selectedPrediction: "", // 'korea', 'draw', 'southafrica'
  unsubscribeMessages: null,
  unsubscribePredictions: null
};

// 금지어 리스트 (초등학교 학급용 부적절한 언어 및 비속어 필터링)
const FORBIDDEN_WORDS = [
  '시발', '씨발', '개새', '새끼', '존나', '좆', '병신', '지랄', '닥쳐', '쓰레기', '느금', '엠창', '아가리', '썅', '개소리'
];

function containsForbiddenWord(text) {
  if (!text) return false;
  const clean = text.toString().replace(/\s+/g, '').toLowerCase(); // 공백 제거 및 소문자화
  return FORBIDDEN_WORDS.some(word => clean.includes(word));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initApp();
  });
} else {
  initApp();
}

async function initApp() {
  // 1. Check URL Parameter ?class=... or local storage
  const urlParams = new URLSearchParams(window.location.search);
  
  // If reset parameter is present or class is explicitly 'none', clear state to go back to invitation screen
  if (urlParams.has('reset') || urlParams.get('class') === 'none') {
    safeStorage.removeItem('current_class_code');
    safeStorage.removeItem('current_student_name');
    appState.studentName = "";
    
    // Clear URL query parameters smoothly
    if (window.history.pushState) {
      const newurl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.pushState({path:newurl}, '', newurl);
    }
  }

  let classParam = urlParams.get('class');

  if (classParam && classParam !== 'none') {
    classParam = classParam.trim().toLowerCase();
    safeStorage.setItem('current_class_code', classParam);
  }

  const savedClassCode = safeStorage.getItem('current_class_code');

  if (!savedClassCode) {
    // Show Class Gate Overlay if no class is selected
    openClassGate();
  } else {
    appState.classCode = savedClassCode;
    closeClassGate();
    await loadClassAndInitRealtime();
  }

  // Pre-fill student name inputs if saved
  if (appState.studentName) {
    const pName = document.getElementById('predict-student-name');
    const cName = document.getElementById('cheer-student-name');
    if (pName) pName.value = appState.studentName;
    if (cName) cName.value = appState.studentName;
  }

  // Start real-time match closing countdown
  startMatchCountdown();
}

/**
 * Loads Class information from Firestore and sets up realtime listeners
 */
async function loadClassAndInitRealtime() {
  const classCode = appState.classCode;
  const classDocRef = doc(db, "classes", classCode);
  
  try {
    const classSnap = await getDoc(classDocRef);
    
    if (classSnap.exists()) {
      const data = classSnap.data();
      appState.className = data.className;
    } else {
      // Auto-create with default name if it doesn't exist yet (to prevent student lockout)
      const defaultName = `${classCode}반`;
      appState.className = defaultName;
      await setDoc(classDocRef, {
        classCode: classCode,
        className: defaultName,
        teacherName: "담임 선생님",
        createdAt: new Date().toISOString()
      });
    }

    // Update Header and Badge UI
    const badge = document.getElementById('current-class-badge');
    if (badge) {
      badge.textContent = `🏫 ${appState.className}`;
      badge.classList.remove('animate-pulse');
    }

    const headerCodeText = document.getElementById('header-class-code-text');
    if (headerCodeText) {
      headerCodeText.textContent = classCode.toUpperCase();
    }

    // Initialize real-time listeners for this classroom
    setupRealtimeListeners();

  } catch (error) {
    console.error("Error loading classroom:", error);
    // Fallback UI
    const badge = document.getElementById('current-class-badge');
    if (badge) {
      badge.textContent = `🏫 ${classCode.toUpperCase()} (오프라인 모드)`;
    }
    const headerCodeText = document.getElementById('header-class-code-text');
    if (headerCodeText) {
      headerCodeText.textContent = classCode.toUpperCase();
    }
  }
}

/**
 * Set up Real-time Firebase listeners for predictions and cheering board
 */
function setupRealtimeListeners() {
  const classCode = appState.classCode;

  // Cleanup old listeners if any
  if (appState.unsubscribeMessages) appState.unsubscribeMessages();
  if (appState.unsubscribePredictions) appState.unsubscribePredictions();

  // 1. Real-time Cheering Messages Listener (ordered by timestamp descending, max 50)
  const messagesQuery = query(
    collection(db, "classes", classCode, "cheering_messages"),
    orderBy("timestamp", "desc"),
    limit(50)
  );

  appState.unsubscribeMessages = onSnapshot(messagesQuery, (snapshot) => {
    const messages = [];
    snapshot.forEach((doc) => {
      messages.push(doc.data());
    });
    renderMessagesFeed(messages);
  }, (error) => {
    console.error("Cheering messages listener error:", error);
  });

  // 2. Real-time Predictions Listener
  const predictionsQuery = collection(db, "classes", classCode, "predictions");

  appState.unsubscribePredictions = onSnapshot(predictionsQuery, (snapshot) => {
    const predictions = [];
    snapshot.forEach((doc) => {
      predictions.push(doc.data());
    });
    
    // Update count labels and ratios
    const countLabel = document.getElementById('prediction-participant-count');
    if (countLabel) {
      countLabel.textContent = predictions.length;
    }
    
    updatePredictionRatios(predictions);
  }, (error) => {
    console.error("Predictions listener error:", error);
  });
}

function renderMessagesFeed(messages) {
  const container = document.getElementById('cheering-board-feed');
  if (!container) return;

  container.innerHTML = '';

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="text-center py-20 text-slate-400 font-semibold space-y-1">
        <p class="text-3xl">💬</p>
        <p class="text-xs font-bold text-slate-400">등록된 응원 한마디가 아직 없습니다.</p>
        <p class="text-[11px] text-slate-350 font-normal">첫 번째 메시지를 등록하고 응원의 불을 지펴보세요!</p>
      </div>
    `;
    return;
  }

  messages.forEach((item, index) => {
    const el = document.createElement('div');
    el.className = "bg-white p-3 rounded-xl border border-slate-200/50 shadow-xs flex justify-between items-center gap-3 transition-all hover:scale-[1.005] hover:shadow-sm";
    
    // Staggered entry animation fade
    el.style.animation = "fadeIn 0.35s ease-out backwards";
    el.style.animationDelay = `${Math.min(index * 0.04, 0.6)}s`;

    const formattedTime = formatFirebaseTimestamp(item.timestamp);

    el.innerHTML = `
      <div class="space-y-1 flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-black text-slate-900 text-[11px] sm:text-xs bg-slate-100 border border-slate-200/60 px-2 py-0.5 rounded-md">${escapeHTML(item.studentName || '익명')}</span>
        </div>
        <p class="text-xs sm:text-xs font-bold text-slate-700 tracking-tight break-all line-clamp-2">
          ${escapeHTML(item.message || '')}
        </p>
      </div>
      <div class="text-[9px] font-mono font-semibold text-slate-400 shrink-0 text-right">
        ${escapeHTML(formattedTime)}
      </div>
    `;

    container.appendChild(el);
  });
}

/**
 * Handle user choice for Prediction
 */
window.selectPrediction = function(id, text) {
  if (isPredictionClosed()) {
    alert("승부예측 참여가 마감되었습니다. (6월 25일 오전 10시 마감)");
    return;
  }

  appState.selectedPrediction = id;
  const hiddenInput = document.getElementById('match-prediction');
  if (hiddenInput) {
    hiddenInput.value = text;
  }

  // highlight styled buttons
  const cards = document.querySelectorAll('.predict-card');
  cards.forEach(card => {
    card.className = "predict-card border border-slate-200 rounded-lg py-2 px-1 text-center bg-white hover:border-slate-300 transition-all";
  });

  const btn = document.getElementById(`predict-${id}`);
  if (btn) {
    if (id === 'korea') btn.className = "predict-card border-2 border-rose-500 rounded-lg py-2 px-1 text-center bg-rose-50 text-rose-700 font-extrabold shadow-sm scale-102";
    if (id === 'draw') btn.className = "predict-card border-2 border-amber-500 rounded-lg py-2 px-1 text-center bg-amber-50 text-amber-700 font-extrabold shadow-sm scale-102";
    if (id === 'southafrica') btn.className = "predict-card border-2 border-emerald-500 rounded-lg py-2 px-1 text-center bg-emerald-50 text-emerald-700 font-extrabold shadow-sm scale-102";
  }
};

/**
 * Predict Event client submission
 */
window.submitPrediction = async function(event) {
  event.preventDefault();

  if (!appState.classCode) {
    alert("입장한 학급 정보가 없습니다. 학급 초대코드를 입력해 먼저 입장해주세요! 🏫");
    openClassGate();
    return;
  }

  if (isPredictionClosed()) {
    alert("승부예측 참여가 마감되었습니다. (6월 25일 오전 10시 마감)");
    return;
  }

  if (appState.isPredictSubmitting) return;

  const nameInput = document.getElementById('predict-student-name');
  const predictInput = document.getElementById('match-prediction');
  const submitBtn = document.getElementById('predict-submit-btn');

  const studentName = nameInput ? nameInput.value.trim() : '';
  const prediction = predictInput ? predictInput.value : '';

  if (!studentName) {
    alert('이름을 바르게 입력해주세요!');
    nameInput.focus();
    return;
  }

  const nameRegex = /^[가-힣]{2,4}$/;
  if (!nameRegex.test(studentName)) {
    alert('이름은 한글 2~4글자(공백 없이)로 기입하셔야 참여 가능합니다.');
    nameInput.focus();
    return;
  }

  if (containsForbiddenWord(studentName)) {
    alert('이름에 부적절한 단어(비속어 등)가 포함되어 있습니다. 바르고 고운 이름을 사용해 주세요! 😊');
    nameInput.focus();
    return;
  }

  if (!prediction) {
    alert('경기 결과를 예측하여 카드를 하나 선택해주세요! 🇰🇷🤝🇿🇦');
    return;
  }

  appState.isPredictSubmitting = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = "<span>데이터 전송 중...</span>";
  }

  const predictionDocRef = doc(db, "classes", appState.classCode, "predictions", studentName);

  try {
    // 1. Check if this student already made a prediction (Document existence check)
    let existingSnap;
    try {
      existingSnap = await getDoc(predictionDocRef);
    } catch (readErr) {
      handleFirestoreError(readErr, 'get', `classes/${appState.classCode}/predictions/${studentName}`);
    }

    if (existingSnap && existingSnap.exists()) {
      alert("이미 승부예측에 참여했습니다. (학급 내 이름별로 1회만 제출 가능합니다.)");
      return;
    }

    // 2. Submit to Firestore
    try {
      await setDoc(predictionDocRef, {
        studentName: studentName,
        prediction: prediction,
        timestamp: serverTimestamp()
      });
    } catch (writeErr) {
      handleFirestoreError(writeErr, 'write', `classes/${appState.classCode}/predictions/${studentName}`);
    }

    // Save student name locally for next time
    safeStorage.setItem("current_student_name", studentName);
    appState.studentName = studentName;
    const cName = document.getElementById('cheer-student-name');
    if (cName) cName.value = studentName;

    // Success UI Feedback
    showPredictionSuccess();

  } catch (error) {
    console.error("Submission failed", error);
    let detailedMsg = error.message || error;
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && parsed.error) {
        detailedMsg = parsed.error;
      }
    } catch (e) {
      // Not a JSON string error message
    }
    alert(`예측 저장 도중 오류가 발생했습니다. (${detailedMsg})\n잠시 후 다시 시도해주세요.`);
  } finally {
    appState.isPredictSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = "<span>🎫 예측 투표 제출</span>";
    }
  }
};

function showPredictionSuccess() {
  const alertBox = document.getElementById('predict-success-alert');
  if (alertBox) {
    alertBox.classList.remove('hidden');
    setTimeout(() => {
      alertBox.classList.add('hidden');
    }, 4500);
  }

  // Resets
  const hiddenInput = document.getElementById('match-prediction');
  if (hiddenInput) hiddenInput.value = '';

  const cards = document.querySelectorAll('.predict-card');
  cards.forEach(card => {
    card.className = "predict-card border border-slate-200 rounded-lg py-2 px-1 text-center bg-white hover:border-slate-300 transition-all";
  });

  popConfetti();
}

/**
 * Cheering Message Submissions
 */
window.submitCheeringMessage = async function(event) {
  event.preventDefault();

  if (!appState.classCode) {
    alert("입장한 학급 정보가 없습니다. 학급 초대코드를 입력해 먼저 입장해주세요! 🏫");
    openClassGate();
    return;
  }

  if (appState.isCheerSubmitting) return;

  const nameInput = document.getElementById('cheer-student-name');
  const msgInput = document.getElementById('cheering-msg');
  const submitBtn = document.getElementById('cheering-submit-btn');

  const studentName = nameInput ? nameInput.value.trim() : '';
  const message = msgInput ? msgInput.value.trim() : '';

  if (!studentName) {
    alert('이름을 적어주세요.');
    nameInput.focus();
    return;
  }

  const nameRegex = /^[가-힣]{2,4}$/;
  if (!nameRegex.test(studentName)) {
    alert('작성자 이름은 한글 2~4글자(공백 없이)로 입력해 주세요.');
    nameInput.focus();
    return;
  }

  if (containsForbiddenWord(studentName) || containsForbiddenWord(message)) {
    alert('작성자 이름 또는 응원 메시지에 부적절한 단어(비속어 등)가 포함되어 있습니다. 바르고 고운 말을 사용해 주세요! 😊');
    if (containsForbiddenWord(studentName)) {
      nameInput.focus();
    } else {
      msgInput.focus();
    }
    return;
  }

  if (!message || message.length > 30) {
    alert('메시지 길이는 1자 이상 30자 이하여야 합니다.');
    msgInput.focus();
    return;
  }

  appState.isCheerSubmitting = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = "<span>메시지 업로드 중... &nbsp;</span>";
  }

  const messagesColRef = collection(db, "classes", appState.classCode, "cheering_messages");

  try {
    await addDoc(messagesColRef, {
      studentName: studentName,
      message: message,
      timestamp: serverTimestamp()
    });

    // Save student name locally
    safeStorage.setItem("current_student_name", studentName);
    appState.studentName = studentName;
    const pName = document.getElementById('predict-student-name');
    if (pName) pName.value = studentName;

    showCheerSuccess();
  } catch (error) {
    console.error('Cheer msg transmit error', error);
    alert('메시지 저장 도중 실패했습니다. 다시 시도해 주세요.');
  } finally {
    appState.isCheerSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = "<span>🚀 실시간 응원전광판에 올리기</span>";
    }
  }
};

function showCheerSuccess() {
  const alertBox = document.getElementById('cheer-success-alert');
  if (alertBox) {
    alertBox.classList.remove('hidden');
    setTimeout(() => {
      alertBox.classList.add('hidden');
    }, 4000);
  }

  const msgInput = document.getElementById('cheering-msg');
  if (msgInput) {
    msgInput.value = '';
    updateCharCount(msgInput);
  }
}

/**
 * Characters Counter length indicator
 */
window.updateCharCount = function(el) {
  const badge = document.getElementById('char-count-badge');
  if (badge) {
    badge.textContent = `${el.value.length}/30`;
  }
};

/**
 * TAB SWITCHING & CLASS REGISTRATION FLOWS
 */
window.switchClassTab = function(tab) {
  const tabJoin = document.getElementById('tab-join');
  const tabCreate = document.getElementById('tab-create');
  const formJoin = document.getElementById('class-join-form');
  const formCreate = document.getElementById('class-create-form');

  if (tab === 'join') {
    tabJoin.className = "flex-1 py-3.5 text-xs sm:text-sm font-black text-rose-600 border-b-2 border-rose-600 focus:outline-none transition-all cursor-pointer";
    tabCreate.className = "flex-1 py-3.5 text-xs sm:text-sm font-bold text-slate-500 border-b-2 border-transparent hover:text-slate-700 focus:outline-none transition-all cursor-pointer";
    formJoin.classList.remove('hidden');
    formCreate.classList.add('hidden');
  } else {
    tabCreate.className = "flex-1 py-3.5 text-xs sm:text-sm font-black text-rose-600 border-b-2 border-rose-600 focus:outline-none transition-all cursor-pointer";
    tabJoin.className = "flex-1 py-3.5 text-xs sm:text-sm font-bold text-slate-500 border-b-2 border-transparent hover:text-slate-700 focus:outline-none transition-all cursor-pointer";
    formCreate.classList.remove('hidden');
    formJoin.classList.add('hidden');
  }
};

window.handleJoinClassForm = async function(event) {
  event.preventDefault();
  
  const codeInput = document.getElementById('gate-join-code');
  let code = codeInput.value.trim().toLowerCase();

  // Validate Code
  const codeRegex = /^[0-9]{4}$/;
  if (!codeRegex.test(code)) {
    alert("학급 초대코드는 숫자 4자리만 가능합니다. (예: 1234)");
    return;
  }

  if (containsForbiddenWord(code)) {
    alert("학급 코드에 부적절한 단어가 포함되어 있습니다.");
    return;
  }

  // Verify class exists in Firestore, if not we prevent student auto-creation (Strategy C)
  const classDocRef = doc(db, "classes", code);
  try {
    const classSnap = await getDoc(classDocRef);
    
    if (classSnap.exists()) {
      const classData = classSnap.data();
      appState.classCode = code;
      appState.className = classData.className;
    } else {
      alert(`초대코드 [${code}]로 개설된 학급이 없습니다. 선생님께서 먼저 '학급개설' 탭을 통해 반을 만들어주셔야 입장할 수 있습니다! 🏫`);
      return;
    }

    // Save info
    safeStorage.setItem('current_class_code', code);

    closeClassGate();
    await loadClassAndInitRealtime();

  } catch (error) {
    console.error("Join class failed:", error);
    alert(`학급 입장 도중 오류가 발생했습니다. (${error.message || error})`);
  }
};

window.handleCreateClassForm = async function(event) {
  event.preventDefault();

  const codeInput = document.getElementById('gate-create-code');
  const authInput = document.getElementById('gate-create-auth');

  let code = codeInput.value.trim();
  const authCode = authInput ? authInput.value.trim() : '';

  // Validate Code (4 digits)
  const codeRegex = /^[0-9]{4}$/;
  if (!codeRegex.test(code)) {
    alert("학급 초대코드는 숫자 4자리만 가능합니다. (예: 1234)");
    return;
  }

  // Validate Teacher Authorization Code
  if (authCode !== 'teacher2026') {
    alert("교사 인증코드가 올바르지 않습니다. 다시 확인해주세요.");
    return;
  }

  if (containsForbiddenWord(code)) {
    alert("초대코드에 부적절한 단어 또는 어휘가 발견되었습니다.");
    return;
  }

  const className = `${code}반`;
  const teacherName = "담임 선생님";

  try {
    const classDocRef = doc(db, "classes", code);
    const existingSnap = await getDoc(classDocRef);

    if (existingSnap.exists()) {
      alert(`초대코드 [${code}]는 이미 개설되어 있습니다. '우리 반 입장하기' 탭을 통해 입장해 주세요.`);
      return;
    }

    // Save class doc
    await setDoc(classDocRef, {
      classCode: code,
      className: className,
      teacherName: teacherName,
      createdAt: new Date().toISOString()
    });

    safeStorage.setItem('current_class_code', code);
    appState.classCode = code;
    appState.className = className;

    closeClassGate();
    await loadClassAndInitRealtime();

    alert(`🎉 [${className}] 학급 개설이 완료되어 입장했습니다! 우측 상단의 '초대장 / QR' 버튼을 눌러 친구들에게 학급 주소와 QR코드를 공유해 보세요!`);

  } catch (error) {
    console.error("Create class error:", error);
    alert(`학급 개설에 실패했습니다. (${error.message || error})`);
  }
};

window.resetClassCode = function() {
  const confirmReset = confirm("학급 코드를 초기화하고 다른 반으로 이동하시겠습니까?\n(입력되어 있던 예측 및 응원은 지워지지 않으며, 첫 화면으로 돌아갑니다.)");
  if (confirmReset) {
    safeStorage.removeItem('current_class_code');
    appState.classCode = "";
    appState.className = "";
    
    // UI reset
    const badge = document.getElementById('current-class-badge');
    if (badge) {
      badge.textContent = `🏫 학급 연결 대기 중...`;
    }
    const headerCodeText = document.getElementById('header-class-code-text');
    if (headerCodeText) {
      headerCodeText.textContent = "----";
    }
    
    // Clear URL parameters to prevent re-join
    if (window.history.pushState) {
      const newurl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.pushState({path:newurl}, '', newurl);
    }
    
    openClassGate();
    alert("학급 코드가 초기화되었습니다. 새로운 학급 코드를 입력하거나 개설해 주세요! 🚪");
  }
};

window.openClassGate = function() {
  const gate = document.getElementById('class-gate-overlay');
  if (gate) {
    gate.classList.remove('hidden');
    // Pre-fill fields
    const savedCode = safeStorage.getItem('current_class_code');
    const gateCode = document.getElementById('gate-join-code');
    if (gateCode && savedCode) gateCode.value = savedCode;
  }
};

function closeClassGate() {
  const gate = document.getElementById('class-gate-overlay');
  if (gate) gate.classList.add('hidden');
}

/**
 * INVITATION / QR MODAL LOGIC
 */
window.openInviteModal = function() {
  const modal = document.getElementById('invite-modal');
  if (!modal) return;

  const classCode = appState.classCode || safeStorage.getItem('current_class_code');
  if (!classCode) {
    alert("입장한 학급이 없습니다. 먼저 학급에 입장하거나 새로 개설해 주세요!");
    openClassGate();
    return;
  }

  // Populate info
  const label = document.getElementById('invite-code-label');
  const qrImg = document.getElementById('invite-qr');
  const linkInput = document.getElementById('invite-link-input');

  if (label) label.textContent = `초대코드: ${classCode.toUpperCase()}`;
  
  // Construct dynamic invite link
  const inviteLink = `${window.location.origin}${window.location.pathname}?class=${classCode}`;
  if (linkInput) linkInput.value = inviteLink;

  // Render dynamic QR Code via qrserver API
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(inviteLink)}`;
  }

  modal.classList.remove('hidden');
};

window.closeInviteModal = function() {
  const modal = document.getElementById('invite-modal');
  if (modal) modal.classList.add('hidden');
};

window.copyInviteLink = function() {
  const linkInput = document.getElementById('invite-link-input');
  if (linkInput) {
    linkInput.select();
    linkInput.setSelectionRange(0, 99999); // for mobile
    
    try {
      navigator.clipboard.writeText(linkInput.value);
      alert("우리 반 전용 초대장 링크가 클립보드에 복사되었습니다! 알림장, 톡방, 클래스팅 등에 공유해보세요! 💌");
    } catch (err) {
      // fallback
      document.execCommand('copy');
      alert("초대장 링크가 복사되었습니다!");
    }
  }
};

// Target closing time: June 25, 2026, 10:00 AM KST (01:00 AM UTC)
const CLOSING_TIME_MS = new Date("2026-06-25T01:00:00Z").getTime();

function isPredictionClosed() {
  return Date.now() >= CLOSING_TIME_MS;
}

function startMatchCountdown() {
  function updateTimer() {
    const timerLabel = document.getElementById('game-countdown-timer');
    const submitBtn = document.getElementById('predict-submit-btn');
    const nameInput = document.getElementById('predict-student-name');
    
    if (!timerLabel) return;
    
    const now = Date.now();
    const diff = CLOSING_TIME_MS - now;
    
    if (diff <= 0) {
      timerLabel.textContent = "승부예측 마감 (종료됨)";
      timerLabel.classList.remove('text-rose-600');
      timerLabel.classList.add('text-slate-500');
      
      // Close Form Inputs completely
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.className = "w-full bg-slate-300 text-slate-500 font-extrabold py-2.5 px-4 rounded-lg shadow-none cursor-not-allowed border-none";
        submitBtn.querySelector('span').textContent = "🔒 승부예측 참여 마감";
      }
      if (nameInput) {
        nameInput.disabled = true;
        nameInput.placeholder = "승부예측이 완전히 마감되었습니다.";
      }
      return true; // closed
    }
    
    // Calculate Day, Hour, Min, Sec
    const seconds = Math.floor((diff / 1000) % 60);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    timerLabel.textContent = `${days}일 ${hours}시간 ${minutes}분 ${seconds}초`;
    return false;
  }
  
  const closed = updateTimer();
  if (!closed) {
    setInterval(updateTimer, 1000);
  }
}

function updatePredictionRatios(list) {
  const ratioKoreaEl = document.getElementById('ratio-korea');
  const ratioDrawEl = document.getElementById('ratio-draw');
  const ratioSouthAfricaEl = document.getElementById('ratio-southafrica');

  if (!ratioKoreaEl || !ratioDrawEl || !ratioSouthAfricaEl) return;

  const closed = isPredictionClosed();

  if (!closed) {
    ratioKoreaEl.classList.add('hidden');
    ratioDrawEl.classList.add('hidden');
    ratioSouthAfricaEl.classList.add('hidden');
    return;
  }

  const total = list.length;
  if (total === 0) {
    ratioKoreaEl.textContent = '0% (0명)';
    ratioDrawEl.textContent = '0% (0명)';
    ratioSouthAfricaEl.textContent = '0% (0명)';
  } else {
    const koreaCount = list.filter(p => {
      const pred = (p.prediction || '').toString().trim();
      return pred === '대한민국 승' || pred === 'korea';
    }).length;

    const drawCount = list.filter(p => {
      const pred = (p.prediction || '').toString().trim();
      return pred === '무승부' || pred === 'draw';
    }).length;

    const southAfricaCount = list.filter(p => {
      const pred = (p.prediction || '').toString().trim();
      return pred === '남아프리카공화국 승' || pred === '남아공 승' || pred === 'southafrica' || pred === 'mexico' || pred === '멕시코 승';
    }).length;

    const koreaPct = Math.round((koreaCount / total) * 100);
    const drawPct = Math.round((drawCount / total) * 100);
    const southAfricaPct = Math.round((southAfricaCount / total) * 100);

    ratioKoreaEl.textContent = `${koreaPct}% (${koreaCount}명)`;
    ratioDrawEl.textContent = `${drawPct}% (${drawCount}명)`;
    ratioSouthAfricaEl.textContent = `${southAfricaPct}% (${southAfricaCount}명)`;
  }

  ratioKoreaEl.classList.remove('hidden');
  ratioDrawEl.classList.remove('hidden');
  ratioSouthAfricaEl.classList.remove('hidden');
}

function escapeHTML(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatFirebaseTimestamp(timestamp) {
  if (!timestamp) return '방금 전';
  try {
    // If it is a Firestore ServerTimestamp, it has toMillis()
    const d = typeof timestamp.toMillis === 'function' ? new Date(timestamp.toMillis()) : new Date(timestamp);
    if (isNaN(d.getTime())) return '방금 전';
    
    // Format to short time "오후 2:15"
    const hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? '오후' : '오전';
    const hour12 = hours % 12 || 12;
    return `${ampm} ${hour12}:${minutes}`;
  } catch (e) {
    return '방금 전';
  }
}

function popConfetti() {
  const holder = document.getElementById('confetti-holder');
  if (!holder) return;

  holder.innerHTML = '';
  const colors = ['#E11D48', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6'];

  for (let i = 0; i < 35; i++) {
    const p = document.createElement('div');
    p.className = 'absolute pointer-events-none rounded-xs';
    
    const left = Math.random() * 100;
    const duration = 1.5 + Math.random() * 1.5;
    const size = 6 + Math.random() * 8;
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    p.style.width = `${size}px`;
    p.style.height = `${size + 2}px`;
    p.style.backgroundColor = color;
    p.style.left = `${left}%`;
    p.style.top = `-20px`;
    
    p.style.opacity = '1';
    p.style.animation = `confetti-fall ${duration}s linear infinite`;
    p.style.animationDelay = `${Math.random() * 0.3}s`;
    
    holder.appendChild(p);
  }

  setTimeout(() => {
    holder.innerHTML = '';
  }, 4500);
}
