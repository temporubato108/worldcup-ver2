/**
 * 초등학교 학급 월드컵 응원전 - 학생용 대시보드 및 결과 발표 (results.js - Firestore Realtime)
 */

import { db } from "./firebase.js";
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc,
  collection, 
  onSnapshot 
} from "firebase/firestore";
import Chart from "chart.js/auto";

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
  if (msg.includes('실패') || msg.includes('오류') || msg.includes('않습니다') || msg.includes('없습니다') || msg.includes('바르게')) {
    type = 'error';
  } else if (msg.includes('완료') || msg.includes('성공') || msg.includes('복사') || msg.includes('가입') || msg.includes('발표') || msg.includes('입장')) {
    type = 'success';
  }
  showToast(msg, type);
};

function showNoClassOverlay() {
  const container = document.createElement('div');
  container.className = 'fixed inset-0 z-50 bg-slate-900/95 backdrop-blur-md flex items-center justify-center p-4';
  container.innerHTML = `
    <div class="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-sm overflow-hidden p-8 text-center space-y-5 animate-in fade-in zoom-in-95 duration-200">
      <span class="text-5xl block animate-bounce">🏫</span>
      <h2 class="text-lg font-black text-slate-900 tracking-tight">입장한 학급이 없습니다</h2>
      <p class="text-xs text-slate-500 font-bold leading-relaxed">
        승부예측 및 실시간 통계를 보려면 먼저 학급에 입장하거나 새로운 학급을 개설해야 합니다.
      </p>
      <div class="pt-2">
        <a href="./index.html" class="inline-block w-full bg-rose-600 hover:bg-rose-500 text-white font-black py-3 rounded-xl text-xs transition-all shadow-md hover:shadow-lg">
          ⚽ 학급 입장 / 개설하러 가기
        </a>
      </div>
    </div>
  `;
  document.body.appendChild(container);
}

const adminState = {
  classCode: "",
  className: "",
  predictions: [],
  simulatedWinner: null, // From Firestore class doc
  unsubscribeClass: null,
  unsubscribePredictions: null
};

let doughnutChartInstance = null;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initBoard();
  });
} else {
  initBoard();
}

async function initBoard() {
  // 1. Check active class code in localStorage
  const classCode = safeStorage.getItem('current_class_code');
  if (!classCode) {
    showNoClassOverlay();
    return;
  }

  adminState.classCode = classCode;

  // Pre-fill endpoints fields in simulator panel
  const endpointInput = document.getElementById('sim-gas-endpoint');
  if (endpointInput) {
    endpointInput.value = "이 앱은 Firebase Firestore 실시간 연동 중입니다 ⚡";
    endpointInput.disabled = true;
  }

  // Set up Firestore real-time listeners for the classroom
  setupRealtimeListeners();
}

/**
 * Set up real-time Firebase listeners for the classroom details and its predictions
 */
function setupRealtimeListeners() {
  const classCode = adminState.classCode;

  // Cleanup old listeners if any
  if (adminState.unsubscribeClass) adminState.unsubscribeClass();
  if (adminState.unsubscribePredictions) adminState.unsubscribePredictions();

  // 1. Listen to Class Document (to get className and simulatedWinner in real-time)
  const classDocRef = doc(db, "classes", classCode);
  adminState.unsubscribeClass = onSnapshot(classDocRef, (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      adminState.className = data.className;
      adminState.simulatedWinner = data.simulatedWinner || null;

      // Update Header dynamic class badge
      const badge = document.getElementById('current-class-badge');
      if (badge) {
        badge.textContent = `🏫 ${data.className}`;
      }

      // Sync simulator button highlights
      updateSimulatorButtonHighlight();

      // Reprocess statistics with updated match result
      if (adminState.predictions.length > 0) {
        processStatistics(adminState.predictions, adminState.simulatedWinner);
      }
    } else {
      console.warn("Classroom document does not exist in Firestore.");
    }
  }, (error) => {
    console.error("Classroom listener error:", error);
  });

  // 2. Listen to Predictions subcollection in real-time
  const predictionsQuery = collection(db, "classes", classCode, "predictions");
  adminState.unsubscribePredictions = onSnapshot(predictionsQuery, (snapshot) => {
    const list = [];
    snapshot.forEach((doc) => {
      list.push(doc.data());
    });

    adminState.predictions = list;
    
    // Process and render stats
    processStatistics(list, adminState.simulatedWinner);
  }, (error) => {
    console.error("Predictions listener error:", error);
  });
}

/**
 * Map various strings to canonical winner label
 */
function mapResultToWinner(r) {
  if (!r) return null;
  const clean = r.toString().trim().toUpperCase();
  if (clean === 'KR' || clean === 'KOREA' || clean === 'KOREA_WIN' || clean === '대한민국 승' || clean === '대한민국승') {
    return '대한민국 승';
  }
  if (clean === 'DRAW' || clean === '무승부') {
    return '무승부';
  }
  if (clean === 'ZA' || clean === 'SOUTH_AFRICA' || clean === 'SOUTH_AFRICA_WIN' || clean === '남아공 승' || clean === '남아프리카공화국 승' || clean === '남아프리카공화국승' || clean === 'MEXICO' || clean === '멕시코 승') {
    return '남아프리카공화국 승';
  }
  return null;
}

/**
 * Handle math calculations, charts render, rankings, and winner screens triggers
 */
function processStatistics(predictions, simulatedWinner) {
  // Filter out any metadata system rows if present
  const studentPreds = predictions.filter(x => {
    const name = (x.studentName || '').toString().trim();
    return name !== "경기결과" && name !== "SYSTEM_RESULT" && name !== "경기 결과" && name !== "RESULT";
  });

  const totalCount = studentPreds.length;
  
  // Aggregate selections
  let koreaCount = 0;
  let drawCount = 0;
  let southAfricaCount = 0;

  studentPreds.forEach(p => {
    const choice = (p.prediction || '').toString().trim();
    if (choice === '대한민국 승' || choice === 'korea') {
      koreaCount++;
    } else if (choice === '무승부' || choice === 'draw') {
      drawCount++;
    } else if (choice === '남아프리카공화국 승' || choice === '남아공 승' || choice === 'southafrica' || choice === '멕시코 승' || choice === 'mexico') {
      southAfricaCount++;
    }
  });

  // Render text counts & percentage strings
  const pctKorea = totalCount > 0 ? ((koreaCount / totalCount) * 100) : 0;
  const pctDraw = totalCount > 0 ? ((drawCount / totalCount) * 100) : 0;
  const pctSouthAfrica = totalCount > 0 ? ((southAfricaCount / totalCount) * 100) : 0;

  // Update counters
  const totalTextEl = document.getElementById('total-participants-text');
  if (totalTextEl) totalTextEl.textContent = totalCount;

  // Update Korea UI Card
  const kCnt = document.getElementById('card-korea-count');
  const kPct = document.getElementById('card-korea-pct');
  if (kCnt) kCnt.textContent = `${koreaCount}명`;
  if (kPct) kPct.textContent = `${pctKorea.toFixed(1)}%`;

  // Update Draw UI Card
  const dCnt = document.getElementById('card-draw-count');
  const dPct = document.getElementById('card-draw-pct');
  if (dCnt) dCnt.textContent = `${drawCount}명`;
  if (dPct) dPct.textContent = `${pctDraw.toFixed(1)}%`;

  // Update South Africa UI Card
  const sCnt = document.getElementById('card-southafrica-count');
  const sPct = document.getElementById('card-southafrica-pct');
  if (sCnt) sCnt.textContent = `${southAfricaCount}명`;
  if (sPct) sPct.textContent = `${pctSouthAfrica.toFixed(1)}%`;

  // Render Doughnut Chart
  renderDoughnutChart(koreaCount, drawCount, southAfricaCount, totalCount);

  // Render Band Chart (띠그래프)
  const bandKoreaEl = document.getElementById('band-korea');
  const bandDrawEl = document.getElementById('band-draw');
  const bandSouthAfricaEl = document.getElementById('band-southafrica');
  const bandEmptyEl = document.getElementById('band-empty');

  const bandKoreaPctEl = document.getElementById('band-korea-pct');
  const bandDrawPctEl = document.getElementById('band-draw-pct');
  const bandSouthAfricaPctEl = document.getElementById('band-southafrica-pct');

  if (totalCount > 0) {
    if (bandEmptyEl) bandEmptyEl.style.display = 'none';

    if (bandKoreaEl) {
      bandKoreaEl.style.width = `${pctKorea}%`;
      bandKoreaEl.style.display = koreaCount > 0 ? 'flex' : 'none';
    }
    if (bandDrawEl) {
      bandDrawEl.style.width = `${pctDraw}%`;
      bandDrawEl.style.display = drawCount > 0 ? 'flex' : 'none';
    }
    if (bandSouthAfricaEl) {
      bandSouthAfricaEl.style.width = `${pctSouthAfrica}%`;
      bandSouthAfricaEl.style.display = southAfricaCount > 0 ? 'flex' : 'none';
    }

    if (bandKoreaPctEl) bandKoreaPctEl.textContent = `${pctKorea.toFixed(1)}%`;
    if (bandDrawPctEl) bandDrawPctEl.textContent = `${pctDraw.toFixed(1)}%`;
    if (bandSouthAfricaPctEl) bandSouthAfricaPctEl.textContent = `${pctSouthAfrica.toFixed(1)}%`;
  } else {
    if (bandKoreaEl) bandKoreaEl.style.display = 'none';
    if (bandDrawEl) bandDrawEl.style.display = 'none';
    if (bandSouthAfricaEl) bandSouthAfricaEl.style.display = 'none';
    if (bandEmptyEl) bandEmptyEl.style.display = 'flex';
  }

  // Render Rankings (🥈 🥇 🥉)
  renderRankings(koreaCount, drawCount, southAfricaCount, totalCount);

  // Check Game State Winner determination (uses Firestore real-time simulatedWinner)
  const officialWinner = simulatedWinner;
  
  const activeCard = document.getElementById('active-match-card');
  const endedCard = document.getElementById('ended-match-card');
  const winnerBadge = document.getElementById('final-winner-display');
  const successAnnounce = document.getElementById('ended-success-announcement');

  if (officialWinner && (officialWinner === '대한민국 승' || officialWinner === '무승부' || officialWinner === '남아프리카공화국 승')) {
    // 1) Show Match Result header state
    if (activeCard) activeCard.classList.add('hidden');
    if (endedCard) endedCard.classList.remove('hidden');
    if (winnerBadge) {
      winnerBadge.textContent = `${officialWinner} 🎉`;
      if (officialWinner === '대한민국 승') {
        winnerBadge.className = "bg-rose-500 text-white px-3.5 py-1 rounded-xl shadow-xs text-sm sm:text-base font-extrabold";
      } else if (officialWinner === '무승부') {
        winnerBadge.className = "bg-amber-500 text-slate-950 px-3.5 py-1 rounded-xl shadow-xs text-sm sm:text-base font-extrabold";
      } else {
        winnerBadge.className = "bg-emerald-500 text-white px-3.5 py-1 rounded-xl shadow-xs text-sm sm:text-base font-extrabold";
      }
    }

    // 2) Show Predictions winners lists
    if (successAnnounce) successAnnounce.classList.remove('hidden');
    
    // Extract students names matching correct prediction
    const correctStudentsObj = studentPreds.filter(p => {
      const pred = (p.prediction || '').toString().trim();
      return pred === officialWinner || 
             (officialWinner === '대한민국 승' && pred === 'korea') ||
             (officialWinner === '무승부' && pred === 'draw') ||
             (officialWinner === '남아프리카공화국 승' && (pred === 'southafrica' || pred === '남아공 승' || pred === 'south_africa' || pred === 'mexico' || pred === '멕시코 승'));
    });

    const correctCount = correctStudentsObj.length;
    const successPercent = totalCount > 0 ? ((correctCount / totalCount) * 100) : 0;

    // Update Hall of Fame Metrics
    const pctDisp = document.getElementById('success-pct-display');
    const ratioDisp = document.getElementById('success-ratio-display');
    const progressEl = document.getElementById('success-progress-bar');
    const winnersListContainer = document.getElementById('winners-names-list');

    if (pctDisp) pctDisp.textContent = `${successPercent.toFixed(1)}%`;
    if (ratioDisp) ratioDisp.textContent = `총 ${totalCount}명 중 ${correctCount}명 성공`;
    if (progressEl) progressEl.style.width = `${successPercent}%`;

    if (winnersListContainer) {
      winnersListContainer.innerHTML = '';
      if (correctCount === 0) {
        winnersListContainer.innerHTML = `
          <div class="text-slate-400 text-xs w-full py-4 text-center font-normal">
            아쉽게도 정답을 맞춘 학생이 아직 없습니다. 😢
          </div>
        `;
      } else {
        correctStudentsObj.forEach(item => {
          const badge = document.createElement('span');
          badge.className = "bg-rose-500/10 text-rose-300 border border-rose-500/20 px-2.5 py-1 rounded-lg text-xs font-bold leading-none hover:bg-rose-500/25 transition-all";
          badge.textContent = item.studentName || '익명';
          winnersListContainer.appendChild(badge);
        });
      }
    }

  } else {
    // Show active matching screen / hide winner announce
    if (activeCard) activeCard.classList.remove('hidden');
    if (endedCard) endedCard.classList.add('hidden');
    if (successAnnounce) successAnnounce.classList.add('hidden');
  }
}

/**
 * Render Chart.js Doughnut Chart
 */
function renderDoughnutChart(korea, draw, mexico, total) {
  const canvas = document.getElementById('predictionDoughnutChart');
  if (!canvas) return;

  if (typeof Chart === 'undefined') {
    console.warn("Chart.js is not loaded. Skipping doughnut chart rendering.");
    return;
  }

  if (doughnutChartInstance) {
    doughnutChartInstance.destroy();
  }

  // If there are zero total votes, create a small grey placeholder
  const hasVotes = total > 0;
  const chartData = hasVotes ? [korea, draw, mexico] : [1, 0, 0];
  const chartColors = hasVotes 
    ? ['#f43f5e', '#fbbf24', '#10b981'] // Rose 500, Amber 400, Emerald 500
    : ['#e2e8f0', '#e2e8f0', '#e2e8f0']; // Slate 200 placeholder

  doughnutChartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['대한민국 승', '무승부', '남아프리카공화국 승'],
      datasets: [{
        data: chartData,
        backgroundColor: chartColors,
        borderWidth: 2,
        borderColor: '#ffffff',
        hoverOffset: hasVotes ? 6 : 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: hasVotes,
          callbacks: {
            label: function(context) {
              const val = context.raw || 0;
              const percent = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
              return ` ${context.label}: ${val}명 (${percent}%)`;
            }
          }
        }
      },
      cutout: '72%'
    },
    plugins: [{
      id: 'centerTotal',
      afterDraw: (chart) => {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        const { left, top, width, height } = chartArea;
        ctx.save();
        ctx.font = '800 13px Inter, system-ui, -apple-system, sans-serif';
        ctx.fillStyle = '#1e293b'; // Slate 800
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${total}명 참여`, left + width / 2, top + height / 2);
        ctx.restore();
      }
    }]
  });
}

/**
 * Render descending ordered ranking elements dynamically (🥇, 🥈, 🥉)
 */
function renderRankings(korea, draw, mexico, total) {
  const container = document.getElementById('prediction-rankings-container');
  if (!container) return;

  const arr = [
    { label: '대한민국 승', count: korea, labelFull: '🇰🇷 대한민국 승', colorBg: 'bg-rose-50/70 border-rose-100/50 text-rose-800' },
    { label: '남아프리카공화국 승', count: mexico, labelFull: '🇿🇦 남아프리카공화국 승', colorBg: 'bg-emerald-50/70 border-emerald-100/50 text-emerald-800' },
    { label: '무승부', count: draw, labelFull: '🤝 무승부', colorBg: 'bg-amber-50/70 border-amber-100/50 text-amber-800' }
  ];

  // sort descending By counts
  arr.sort((a, b) => b.count - a.count);

  const medals = ['🥇', '🥈', '🥉'];
  container.innerHTML = '';

  arr.forEach((item, index) => {
    const pct = total > 0 ? ((item.count / total) * 100).toFixed(1) : '0.0';
    
    const div = document.createElement('div');
    div.className = `flex justify-between items-center px-4 py-2.5 rounded-2xl border border-slate-100/80 bg-slate-50/60 font-bold text-xs sm:text-sm hover:scale-[1.01] transition-transform duration-300`;
    div.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="text-base select-none">${medals[index]}</span>
        <span class="text-slate-800 font-extrabold">${item.labelFull}</span>
      </div>
      <div class="flex items-center gap-1.5 font-mono text-slate-500 font-bold">
        <span class="text-slate-800">${item.count}명</span>
        <span class="text-slate-300">•</span>
        <span class="text-[11px] font-black">${pct}%</span>
      </div>
    `;
    container.appendChild(div);
  });
}

/**
 * SIMULATOR PANEL CONTROLLER METHODS
 */
let isTeacherVerified = false;

window.toggleTeacherPanel = function() {
  const verifyBox = document.getElementById('teacher-verification-box');
  const controlsContent = document.getElementById('teacher-controls-content');
  const toggleBtn = document.getElementById('btn-toggle-teacher-panel');

  if (!verifyBox || !controlsContent) return;

  // If currently visible, hide everything
  if (!verifyBox.classList.contains('hidden') || !controlsContent.classList.contains('hidden')) {
    verifyBox.classList.add('hidden');
    controlsContent.classList.add('hidden');
    if (toggleBtn) toggleBtn.textContent = '[클릭해서 펼치기 / 접기]';
    return;
  }

  // If opening, check if verified
  if (isTeacherVerified) {
    controlsContent.classList.remove('hidden');
  } else {
    verifyBox.classList.remove('hidden');
    const input = document.getElementById('teacher-passcode-input');
    if (input) {
      input.value = '';
      input.focus();
    }
  }
  if (toggleBtn) toggleBtn.textContent = '[접기]';
};

window.verifyTeacherCode = function() {
  const input = document.getElementById('teacher-passcode-input');
  const errorMsg = document.getElementById('teacher-verification-error');
  const verifyBox = document.getElementById('teacher-verification-box');
  const controlsContent = document.getElementById('teacher-controls-content');

  if (!input) return;

  if (input.value.trim() === 'teacher2026') {
    isTeacherVerified = true;
    if (errorMsg) errorMsg.classList.add('hidden');
    if (verifyBox) verifyBox.classList.add('hidden');
    if (controlsContent) controlsContent.classList.remove('hidden');
    alert("👨‍🏫 교사 인증이 완료되었습니다!");
  } else {
    if (errorMsg) errorMsg.classList.remove('hidden');
    alert("❌ 올바르지 않은 교사 인증 코드입니다.");
  }
};

window.saveSimUrl = function() {
  alert("현재 Firebase Firestore와 완벽하게 실시간 동기화 연동되어 수동 endpoint는 필요하지 않습니다.");
};

window.clearSimUrl = function () {
  alert("현재 Firebase Firestore와 완벽하게 실시간 동기화 연동되어 수동 endpoint는 필요하지 않습니다.");
};

window.setSimResult = async function(val) {
  const classCode = adminState.classCode;
  if (!classCode) return;

  const classDocRef = doc(db, "classes", classCode);
  const canonicalVal = mapResultToWinner(val);

  try {
    await updateDoc(classDocRef, {
      simulatedWinner: canonicalVal
    });
    console.log(`Successfully updated simulatedWinner in Firestore to: ${canonicalVal}`);
  } catch (error) {
    console.error("Error setting simulation winner:", error);
    alert("시뮬레이션 경기결과 설정 도중 오류가 발생했습니다.");
  }
};

function updateSimulatorButtonHighlight() {
  const current = adminState.simulatedWinner;
  
  const bNone = document.getElementById('btn-result-none');
  const bKorea = document.getElementById('btn-result-korea');
  const bDraw = document.getElementById('btn-result-draw');
  const bSouthAfrica = document.getElementById('btn-result-southafrica') || document.getElementById('btn-result-mexico');

  if (!bNone || !bKorea || !bDraw || !bSouthAfrica) return;

  // reset classes
  bNone.className = "bg-slate-100 hover:bg-slate-200 px-2.5 py-1 text-slate-700 rounded text-[10px] font-bold border border-slate-200 cursor-pointer transition-all";
  bKorea.className = "bg-rose-50 text-rose-800 border border-rose-200/40 px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer transition-all";
  bDraw.className = "bg-amber-50 text-amber-800 border border-amber-200/40 px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer transition-all";
  bSouthAfrica.className = "bg-emerald-50 text-emerald-800 border border-emerald-200/40 px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer transition-all";

  if (current === '대한민국 승') {
    bKorea.className = "bg-rose-500 text-white border border-rose-600 px-3 py-1 rounded text-[10px] font-black shadow-xs ring-2 ring-rose-500/20 cursor-pointer transition-all scale-102";
  } else if (current === '무승부') {
    bDraw.className = "bg-amber-500 text-slate-900 border border-amber-600 px-3 py-1 rounded text-[10px] font-black shadow-xs ring-2 ring-amber-500/20 cursor-pointer transition-all scale-102";
  } else if (current === '남아프리카공화국 승' || current === '멕시코 승') {
    bSouthAfrica.className = "bg-emerald-500 text-white border border-emerald-600 px-3 py-1 rounded text-[10px] font-black shadow-xs ring-2 ring-emerald-500/20 cursor-pointer transition-all scale-102";
  } else {
    bNone.className = "bg-slate-800 text-white border border-slate-900 px-2.5 py-1 rounded text-[10px] font-black shadow-xs cursor-pointer transition-all scale-102";
  }
}
