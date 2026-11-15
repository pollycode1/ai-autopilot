// ===== Utility =====
const fmt = (n, digits = 0) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtBaht = (n, digits = 0) => fmt(n, digits) + " บาท";

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error("โหลดข้อมูลไม่สำเร็จ: " + path);
  return res.json();
}

let INVESTMENTS = [];
let STRATEGIES = [];

// ===== Tabs =====
function initTabs() {
  const btns = document.querySelectorAll(".tab-btn");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });
}

// ===== Overview cards =====
function renderCards() {
  const wrap = document.getElementById("cards");
  wrap.innerHTML = "";
  INVESTMENTS.forEach((inv) => {
    const card = document.createElement("div");
    card.className = "inv-card";
    card.innerHTML = `
      <h3>${inv.name}</h3>
      <p>${inv.shortDesc}</p>
      <p><strong>ผลตอบแทนคาดหวัง:</strong> ${inv.expectedReturn}</p>
      <span class="badge risk-${inv.riskScore}">ความเสี่ยง: ${inv.risk}</span>
    `;
    card.addEventListener("click", () => openDetail(inv));
    wrap.appendChild(card);
  });
}

function openDetail(inv) {
  const body = document.getElementById("modalBody");
  body.innerHTML = `
    <h2>${inv.name}</h2>
    <p>${inv.shortDesc}</p>
    <p><strong>ผลตอบแทนคาดหวัง:</strong> ${inv.expectedReturn}</p>
    <p><strong>ความเสี่ยง:</strong> <span class="badge risk-${inv.riskScore}">${inv.risk}</span></p>
    <p><strong>สภาพคล่อง:</strong> ${inv.liquidity}</p>
    <p><strong>เงินลงทุนขั้นต่ำ:</strong> ${inv.minInvestment}</p>
    <p><strong>ภาษี/สิทธิลดหย่อน:</strong> ${inv.tax}</p>
    <p><strong>ช่องทางลงทุนในไทย:</strong> ${inv.channels.join(", ")}</p>
    <p><strong>ข้อดี:</strong></p>
    <ul>${inv.pros.map((p) => `<li>${p}</li>`).join("")}</ul>
    <p><strong>ข้อเสีย:</strong></p>
    <ul>${inv.cons.map((c) => `<li>${c}</li>`).join("")}</ul>
    <p class="source-note">แหล่งที่มา: ${inv.source.name} — <a href="${inv.source.url}" target="_blank" rel="noopener">${inv.source.url}</a><br>${inv.source.date}</p>
  `;
  document.getElementById("detailModal").classList.remove("hidden");
}

function initModal() {
  document.getElementById("modalClose").addEventListener("click", () => {
    document.getElementById("detailModal").classList.add("hidden");
  });
  document.getElementById("detailModal").addEventListener("click", (e) => {
    if (e.target.id === "detailModal") e.target.classList.add("hidden");
  });
}

// ===== Compare table + chart =====
function renderCompare() {
  const tbody = document.querySelector("#compareTable tbody");
  tbody.innerHTML = "";
  INVESTMENTS.forEach((inv) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${inv.name}</td>
      <td>${inv.expectedReturn}</td>
      <td>${inv.risk}</td>
      <td>${inv.liquidity}</td>
      <td>${inv.minInvestment}</td>
      <td>${inv.tax}</td>
    `;
    tbody.appendChild(tr);
  });
  drawRiskReturnChart();
}

function approxReturnMidpoint(inv) {
  const matches = inv.expectedReturn.match(/-?\d+(\.\d+)?/g);
  if (!matches) return inv.riskScore * 2;
  const nums = matches.map(Number).filter((n) => Math.abs(n) <= 100);
  if (!nums.length) return inv.riskScore * 2;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function drawRiskReturnChart() {
  const canvas = document.getElementById("riskReturnChart");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const padding = { left: 60, right: 30, top: 20, bottom: 50 };
  const plotW = W - padding.left - padding.right;
  const plotH = H - padding.top - padding.bottom;

  // axes
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, H - padding.bottom);
  ctx.lineTo(W - padding.right, H - padding.bottom);
  ctx.stroke();

  const maxReturn = 14;
  const maxRisk = 5;

  ctx.fillStyle = "#94a3b8";
  ctx.font = "12px sans-serif";
  ctx.fillText("ความเสี่ยง (1=ต่ำมาก, 5=สูงมาก) →", padding.left, H - 15);
  ctx.save();
  ctx.translate(15, H - padding.bottom);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("ผลตอบแทนคาดหวัง (% ต่อปี) →", 0, 0);
  ctx.restore();

  // grid + y labels
  for (let r = 0; r <= maxReturn; r += 2) {
    const y = H - padding.bottom - (r / maxReturn) * plotH;
    ctx.strokeStyle = "#1e293b";
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(W - padding.right, y);
    ctx.stroke();
    ctx.fillStyle = "#64748b";
    ctx.fillText(r + "%", 10, y + 4);
  }
  for (let r = 1; r <= maxRisk; r++) {
    const x = padding.left + (r / maxRisk) * plotW;
    ctx.fillStyle = "#64748b";
    ctx.fillText(String(r), x - 3, H - padding.bottom + 18);
  }

  INVESTMENTS.forEach((inv, i) => {
    const x = padding.left + (inv.riskScore / maxRisk) * plotW;
    const retVal = Math.max(0, Math.min(maxReturn, approxReturnMidpoint(inv)));
    const y = H - padding.bottom - (retVal / maxReturn) * plotH;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${(i * 47) % 360}, 70%, 55%)`;
    ctx.fill();
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "11px sans-serif";
    ctx.fillText(inv.name, x + 10, y + 4);
  });
}

// ===== Risk quiz =====
const RISK_QUESTIONS = [
  {
    q: "ระยะเวลาที่คุณจะใช้เงินก้อนนี้?",
    options: [
      { text: "ภายใน 1-2 ปี", score: 1 },
      { text: "3-5 ปี", score: 2 },
      { text: "6-10 ปี", score: 3 },
      { text: "มากกว่า 10 ปี", score: 4 },
    ],
  },
  {
    q: "ถ้าเงินลงทุนของคุณลดลง 20% ในเวลาสั้นๆ คุณจะทำอย่างไร?",
    options: [
      { text: "ขายทันทีเพื่อหยุดการขาดทุน", score: 1 },
      { text: "รู้สึกกังวลมาก แต่รอดูสถานการณ์", score: 2 },
      { text: "ถือต่อไปตามแผนเดิม", score: 3 },
      { text: "มองเป็นโอกาสซื้อเพิ่ม", score: 4 },
    ],
  },
  {
    q: "ประสบการณ์การลงทุนของคุณ?",
    options: [
      { text: "ไม่มีเลย เพิ่งเริ่มศึกษา", score: 1 },
      { text: "มีบ้าง เคยลงทุนกองทุน/พันธบัตร", score: 2 },
      { text: "มีประสบการณ์ลงทุนหุ้น/กองทุนหลายปี", score: 3 },
      { text: "มีประสบการณ์หลากหลายสินทรัพย์รวมถึงสินทรัพย์เสี่ยงสูง", score: 4 },
    ],
  },
  {
    q: "เป้าหมายหลักของการลงทุนครั้งนี้?",
    options: [
      { text: "รักษาเงินต้น ไม่ต้องการให้ขาดทุน", score: 1 },
      { text: "ได้ผลตอบแทนสูงกว่าเงินฝากเล็กน้อยอย่างสม่ำเสมอ", score: 2 },
      { text: "เติบโตของเงินในระยะยาวแบบสมดุล", score: 3 },
      { text: "เติบโตสูงสุด ยอมรับความผันผวนได้มาก", score: 4 },
    ],
  },
];

function renderRiskQuiz() {
  const form = document.getElementById("riskForm");
  form.innerHTML = "";
  RISK_QUESTIONS.forEach((item, qi) => {
    const div = document.createElement("div");
    div.className = "quiz-q";
    div.innerHTML = `<span class="q-title">${qi + 1}. ${item.q}</span>`;
    item.options.forEach((opt, oi) => {
      const label = document.createElement("label");
      label.innerHTML = `<input type="radio" name="q${qi}" value="${opt.score}" ${oi === 0 ? "" : ""}> ${opt.text}`;
      div.appendChild(label);
    });
    form.appendChild(div);
  });
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-primary";
  btn.textContent = "ดูผลประเมิน";
  btn.addEventListener("click", computeRiskResult);
  form.appendChild(btn);
}

function computeRiskResult() {
  let total = 0, answered = 0;
  RISK_QUESTIONS.forEach((_, qi) => {
    const sel = document.querySelector(`input[name="q${qi}"]:checked`);
    if (sel) { total += Number(sel.value); answered++; }
  });
  const resultBox = document.getElementById("riskResult");
  if (answered < RISK_QUESTIONS.length) {
    resultBox.classList.remove("hidden");
    resultBox.innerHTML = `<p>กรุณาตอบคำถามให้ครบทุกข้อก่อนดูผลประเมิน</p>`;
    return;
  }
  const maxScore = RISK_QUESTIONS.length * 4;
  const minScore = RISK_QUESTIONS.length * 1;
  const pct = (total - minScore) / (maxScore - minScore); // 0..1

  let profile;
  if (pct < 0.34) profile = STRATEGIES.find((s) => s.id === "conservative");
  else if (pct < 0.67) profile = STRATEGIES.find((s) => s.id === "balanced");
  else profile = STRATEGIES.find((s) => s.id === "growth");

  resultBox.classList.remove("hidden");
  resultBox.innerHTML = `
    <h3>ระดับความเสี่ยงที่รับได้: ${profile.name}</h3>
    <p>${profile.suitable}</p>
    <p><strong>เป้าหมายผลตอบแทน:</strong> ${profile.expectedReturn}</p>
    <p><strong>สัดส่วนพอร์ตที่แนะนำ (ตัวอย่างเพื่อการศึกษา):</strong></p>
    <div class="alloc-bars">
      ${profile.allocation
        .map(
          (a) => `
        <div class="alloc-row">
          <span class="label">${a.type}</span>
          <div class="bar-bg"><div class="bar-fill" style="width:${a.pct}%"></div></div>
          <span class="pct">${a.pct}%</span>
        </div>`
        )
        .join("")}
    </div>
    <p class="source-note">⚠️ นี่เป็นตัวอย่างสัดส่วนเพื่อการศึกษาเท่านั้น ไม่ใช่คำแนะนำการลงทุนเฉพาะบุคคล ควรพิจารณาสถานการณ์การเงินของตนเองหรือปรึกษาผู้แนะนำการลงทุนที่ได้รับอนุญาต</p>
  `;
}

// ===== Calculators =====
function calcDCA() {
  const monthly = Number(document.getElementById("dcaMonthly").value) || 0;
  const annualReturn = Number(document.getElementById("dcaReturn").value) || 0;
  const years = Number(document.getElementById("dcaYears").value) || 0;
  const months = years * 12;
  const monthlyRate = annualReturn / 100 / 12;

  let balance = 0;
  const yearlyBalances = [];
  for (let m = 1; m <= months; m++) {
    balance = balance * (1 + monthlyRate) + monthly;
    if (m % 12 === 0) yearlyBalances.push(balance);
  }
  const totalInvested = monthly * months;
  const totalGain = balance - totalInvested;

  const box = document.getElementById("dcaResult");
  box.classList.remove("hidden");
  box.innerHTML = `
    <p><strong>เงินลงทุนรวมตลอด ${years} ปี:</strong> ${fmtBaht(totalInvested)}</p>
    <p><strong>มูลค่าพอร์ตโดยประมาณเมื่อครบกำหนด:</strong> ${fmtBaht(balance)}</p>
    <p><strong>กำไร/ผลตอบแทนสะสมโดยประมาณ:</strong> ${fmtBaht(totalGain)}</p>
    <p class="source-note">คำนวณแบบประมาณการ สมมติผลตอบแทนคงที่ทุกเดือน (ไม่รวมค่าธรรมเนียม/ภาษี) ผลตอบแทนจริงจะผันผวนตามสภาวะตลาด</p>
  `;
}

function calcCompoundInterest() {
  const principal = Number(document.getElementById("ciPrincipal").value) || 0;
  const annualReturn = Number(document.getElementById("ciReturn").value) || 0;
  const years = Number(document.getElementById("ciYears").value) || 0;
  const freq = Number(document.getElementById("ciFreq").value) || 1;

  const rate = annualReturn / 100;
  const amount = principal * Math.pow(1 + rate / freq, freq * years);
  const gain = amount - principal;

  const box = document.getElementById("ciResult");
  box.classList.remove("hidden");
  box.innerHTML = `
    <p><strong>เงินต้น:</strong> ${fmtBaht(principal)}</p>
    <p><strong>มูลค่าเมื่อครบ ${years} ปี:</strong> ${fmtBaht(amount)}</p>
    <p><strong>ผลตอบแทนสะสม:</strong> ${fmtBaht(gain)}</p>
  `;
}

function calcGoal() {
  const target = Number(document.getElementById("goalTarget").value) || 0;
  const start = Number(document.getElementById("goalStart").value) || 0;
  const annualReturn = Number(document.getElementById("goalReturn").value) || 0;
  const years = Number(document.getElementById("goalYears").value) || 0;
  const months = years * 12;
  const monthlyRate = annualReturn / 100 / 12;

  const futureValueOfStart = start * Math.pow(1 + monthlyRate, months);
  const remaining = target - futureValueOfStart;

  const box = document.getElementById("goalResult");
  box.classList.remove("hidden");

  if (remaining <= 0) {
    box.innerHTML = `<p>เงินก้อนที่มีอยู่แล้วเติบโตถึงเป้าหมายได้โดยไม่ต้องลงทุนเพิ่มเติม (โดยประมาณ)</p>`;
    return;
  }

  // PMT formula for future value of an ordinary annuity
  let monthlyPMT;
  if (monthlyRate === 0) {
    monthlyPMT = remaining / months;
  } else {
    monthlyPMT = remaining * monthlyRate / (Math.pow(1 + monthlyRate, months) - 1);
  }

  box.innerHTML = `
    <p><strong>เป้าหมาย:</strong> ${fmtBaht(target)} ภายใน ${years} ปี</p>
    <p><strong>ต้องลงทุนเพิ่มเดือนละประมาณ:</strong> ${fmtBaht(monthlyPMT)}</p>
    <p class="source-note">คำนวณแบบประมาณการจากสมมติฐานผลตอบแทนคงที่ ไม่รวมค่าธรรมเนียม/ภาษี/เงินเฟ้อ</p>
  `;
}

function initCalculators() {
  document.getElementById("dcaBtn").addEventListener("click", calcDCA);
  document.getElementById("ciBtn").addEventListener("click", calcCompoundInterest);
  document.getElementById("goalBtn").addEventListener("click", calcGoal);
}

// ===== Strategies tab =====
function renderStrategies() {
  const wrap = document.getElementById("strategies");
  wrap.innerHTML = "";
  STRATEGIES.forEach((s) => {
    const card = document.createElement("div");
    card.className = "strategy-card";
    card.innerHTML = `
      <h2>${s.name}</h2>
      <p>${s.suitable}</p>
      <p><strong>เป้าหมายผลตอบแทน:</strong> ${s.expectedReturn}</p>
      <div class="alloc-bars">
        ${s.allocation
          .map(
            (a) => `
          <div class="alloc-row">
            <span class="label">${a.type}</span>
            <div class="bar-bg"><div class="bar-fill" style="width:${a.pct}%"></div></div>
            <span class="pct">${a.pct}%</span>
          </div>`
          )
          .join("")}
      </div>
      <p><strong>หมายเหตุ:</strong></p>
      <ul>${s.notes.map((n) => `<li>${n}</li>`).join("")}</ul>
    `;
    wrap.appendChild(card);
  });
}

// ===== Init =====
async function init() {
  initTabs();
  initModal();
  initCalculators();
  try {
    [INVESTMENTS, STRATEGIES] = await Promise.all([
      loadJSON("data/investments.json"),
      loadJSON("data/strategies.json"),
    ]);
  } catch (err) {
    document.getElementById("cards").innerHTML =
      '<p style="color:#fca5a5">ไม่สามารถโหลดข้อมูลได้ หากเปิดไฟล์นี้โดยตรง (file://) บางเบราว์เซอร์จะบล็อกการโหลดไฟล์ JSON ด้วยเหตุผลด้านความปลอดภัย ' +
      "กรุณาเปิดผ่านเว็บเซิร์ฟเวอร์เล็กๆ เช่นคำสั่ง <code>python3 -m http.server</code> แล้วเปิด http://localhost:8000 แทน (ดูวิธีใช้ใน README.md)</p>";
    console.error(err);
    return;
  }
  renderCards();
  renderCompare();
  renderRiskQuiz();
  renderStrategies();
}

init();
