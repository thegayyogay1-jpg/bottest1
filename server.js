const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
app.use(express.json());

global.currentReplyFlex = null;

// 💡 ดึง Token จากตัวแปรสภาพแวดล้อมบน Render
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// 👥 [กล่องรวม ID แอดมินกลาง]
const ADMIN_IDS = [
    "Ub5622951ba512db7f8461fa6675170ba", // แอดมินคนที่ 1
    "" // แอดมินคนที่ 2
];

// 📡 ลิงก์เชื่อมโยงไปยังฐานข้อมูล Firebase ถาวร 
const FIREBASE_URL = "https://my-pokdeng-bot-default-rtdb.asia-southeast1.firebasedatabase.app/"; 

let usersWallets = {};
let nextMemberId = 1;
let isRoundOpen = false; 
let roundBets = {};      
let currentRound = 0;    
let tempRoomResults = null; 
let tempDealerResult = null; 
let matchHistory = []; 
let detailedRoundHistory = {}; 
let pastRoundsData = {}; 
let withdrawQueue = []; 
let usersRoundCrossCheck = {}; 
global.depositQueue = {}; 
if (!global.satangCounter) global.satangCounter = 0;

// 🔄 ฟังก์ชันอัตโนมัติ: ดึงข้อมูลจาก Firebase
async function loadDataFromFirebase() {
    try {
        const response = await axios.get(`${FIREBASE_URL}system_data.json`);
        if (response.data) {
            usersWallets = response.data.usersWallets || {};
            nextMemberId = response.data.nextMemberId || 1;
            isRoundOpen = response.data.isRoundOpen !== undefined ? response.data.isRoundOpen : false;
            roundBets = response.data.roundBets || {};
            currentRound = response.data.currentRound || 0;
            matchHistory = response.data.matchHistory || [];
            detailedRoundHistory = response.data.detailedRoundHistory || {};
            pastRoundsData = response.data.pastRoundsData || {};
            withdrawQueue = response.data.withdrawQueue || [];
            console.log("✅ ดึงข้อมูลระบบทั้งหมดจาก Firebase สำเร็จเรียบร้อย!");
        }
    } catch (error) {
        console.error("❌ ไม่สามารถดึงข้อมูลจาก Firebase ได้:", error.message);
    }
}
loadDataFromFirebase();

// 🤖 [ระบบฝากออโต้] ตรวจสอบยอดเงินจากเศษสตางค์
async function checkAutoDeposit() {
    if (!global.depositQueue) return;
    
    try {
        const bankTransactions = global.bankTransactions || []; 

        for (let userId in global.depositQueue) {
            const queue = global.depositQueue[userId];

            if (!queue || queue.status !== 'WAITING_ADMIN') continue;

            const matchIndex = bankTransactions.findIndex(tx => 
                parseFloat(tx.amount).toFixed(2) === parseFloat(queue.displayAmount).toFixed(2)
            );

            if (matchIndex !== -1) {
                const user = usersWallets[userId];

                if (user) {
                    user.balance = (user.balance || 0) + Number(queue.rawAmount);
                    await saveDataToFirebase();
                    bankTransactions.splice(matchIndex, 1);
                    delete global.depositQueue[userId];
                    console.log(`✅ [เติมเงียบสำเร็จ] ยูสเซอร์ [${user.memberNumber || '-'}] ${user.nickname || user.name} | ยอด ${queue.displayAmount} ฿ -> เครดิตใหม่: ${user.balance} ฿`);
                }
            }
        }
    } catch (err) {
        console.error("❌ ระบบตรวจสอบฝากออโต้ผิดพลาด:", err.message);
    }
}

setInterval(checkAutoDeposit, 15000);

// 💾 บันทึกข้อมูลลง Firebase
async function saveDataToFirebase() {
    try {
        await axios.put(`${FIREBASE_URL}system_data.json`, {
            usersWallets: usersWallets,
            nextMemberId: nextMemberId,
            isRoundOpen: isRoundOpen,         
            roundBets: roundBets,             
            currentRound: currentRound,       
            matchHistory: matchHistory,       
            detailedRoundHistory: detailedRoundHistory, 
            pastRoundsData: pastRoundsData,   
            withdrawQueue: withdrawQueue       
        });
        console.log("💾 บันทึกข้อมูลลง Firebase เรียบร้อย!");
    } catch (error) {
        console.error("❌ บันทึกข้อมูลลง Firebase ล้มเหลว:", error.message);
    }
}

app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        // =================================================================
        // 📸 ดักจับรูปภาพสลิป + เตือนแอดมิน
        // =================================================================
        if (event.type === 'message' && event.message.type === 'image') {
            const replyToken = event.replyToken;
            const userId = event.source.userId;

            if (global.depositQueue && global.depositQueue[userId] && global.depositQueue[userId].status === 'WAITING_ADMIN') {
                const currentQueue = global.depositQueue[userId];
                const messageId = event.message.id;
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                
                const filename = `slip-${currentQueue.memberId}.jpg`;

                try {
                    const response = await axios({
                        method: 'get',
                        url: `https://api-data.line.me/v2/bot/message/${messageId}/content`,
                        responseType: 'stream',
                        headers: { 'Authorization': `Bearer ${TOKEN}` }
                    });

                    const writer = fs.createWriteStream(filename);
                    response.data.pipe(writer);

                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                    });

                    const myServerUrl = `https://linepok3p.onrender.com/${filename}`;

                    const adminFlexMessage = {
                        "type": "flex",
                        "altText": `🔔 แจ้งโอนเงินจากสมาชิกที่ ${currentQueue.memberId}`,
                        "contents": {
                            "type": "bubble",
                            "size": "giga",
                            "styles": {
                                "header": { "backgroundColor": "#111111" },
                                "body": { "backgroundColor": "#1c1c1c" },
                                "footer": { "backgroundColor": "#111111" }
                            },
                            "header": {
                                "type": "box",
                                "layout": "vertical",
                                "contents": [
                                    { "type": "text", "text": "🔔 มีรายการแจ้งโอนเงินใหม่!", "weight": "bold", "color": "#ffbb00", "size": "md", "align": "center" }
                                ]
                            },
                            "body": {
                                "type": "box",
                                "layout": "vertical",
                                "spacing": "sm",
                                "contents": [
                                    { "type": "text", "text": `🆔 สมาชิกลำดับที่: ${currentQueue.memberId}`, "color": "#ffffff", "size": "sm" },
                                    { "type": "text", "text": `👤 ชื่อ: คุณ ${currentQueue.name}`, "color": "#cccccc", "size": "sm" },
                                    { "type": "text", "text": `💰 ยอดเงินในคิว: ${currentQueue.displayAmount} บาท`, "color": "#00ffcc", "weight": "bold", "size": "md" },
                                    { "type": "separator", "color": "#333333", "margin": "md" },
                                    { "type": "text", "text": "🤖 [ระบบออโต้]: กำลังรอเช็กยอดโอนและเศษสตางค์ตรงกับระบบแจ้งเตือน...", "color": "#888888", "size": "xs", "wrap": true, "margin": "sm" }
                                ]
                            },
                            "footer": {
                                "type": "box",
                                "layout": "vertical",
                                "spacing": "sm",
                                "contents": [
                                    {
                                        "type": "button",
                                        "style": "primary",
                                        "color": "#00aa5b",
                                        "height": "sm",
                                        "action": {
                                            "type": "message",
                                            "label": "✅ เติมเงินปกติ",
                                            "text": `เติม ${currentQueue.memberId} ${currentQueue.rawAmount}`
                                        }
                                    },
                                    {
                                        "type": "button",
                                        "style": "primary",
                                        "color": "#0088cc",
                                        "height": "sm",
                                        "action": {
                                            "type": "message",
                                            "label": "🎁 เติมแบบติดโปร (B)",
                                            "text": `B ${currentQueue.memberId} [ยอดรวมโบนัส]`
                                        }
                                    },
                                    {
                                        "type": "button",
                                        "style": "secondary",
                                        "color": "#cc3333",
                                        "height": "sm",
                                        "action": {
                                            "type": "message",
                                            "label": "❌ ปฏิเสธรายการ (cc)",
                                            "text": `cc ${currentQueue.memberId}`
                                        }
                                    }
                                ]
                            }
                        }
                    };

                    await axios.post('https://api.line.me/v2/bot/message/push', {
                        to: ADMIN_ID,
                        messages: [
                            { type: 'image', originalContentUrl: myServerUrl, previewImageUrl: myServerUrl },
                            adminFlexMessage
                        ]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });

                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [
                            {
                                "type": "flex",
                                "altText": "✅ ได้รับสลิปเรียบร้อยแล้วค่ะ",
                                "contents": {
                                    "type": "bubble",
                                    "styles": { "body": { "backgroundColor": "#09120e" } },
                                    "body": {
                                        "type": "box",
                                        "layout": "vertical",
                                        "spacing": "md",
                                        "contents": [
                                            { "type": "text", "text": "✅ ได้รับรูปภาพสลิปแล้ว", "weight": "bold", "color": "#00ff88", "size": "md", "align": "center" },
                                            { "type": "separator", "color": "#12251c" },
                                            {
                                                "type": "box",
                                                "layout": "horizontal",
                                                "contents": [
                                                    { "type": "text", "text": "💰 ยอดโอนในคิว:", "size": "sm", "color": "#8caf9c" },
                                                    { "type": "text", "text": `${currentQueue.displayAmount} บาท`, "size": "sm", "color": "#00ff88", "weight": "bold", "align": "end" }
                                                ]
                                            },
                                            { "type": "separator", "color": "#12251c" },
                                            { "type": "text", "text": "⏳ ระบบกำลังตรวจสอบความถูกต้อง กรุณารอเครดิตเข้ากระเป๋าสักครู่ค่ะ 🏁", "size": "xs", "color": "#cccccc", "wrap": true, "align": "center" }
                                        ]
                                    }
                                }
                            }
                        ]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });

                } catch (err) {
                    console.error("❌ ระบบแจ้งเตือนรูปสลิปล้มเหลว:", err.message);
                }
                return res.sendStatus(200); 
            }
            return res.sendStatus(200);
        }

        // =================================================================
        // 💬 ดักจับข้อความ Text
        // =================================================================
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const userId = event.source.userId; 
            const originalMsg = event.message.text.trim(); 
            const userMsg = originalMsg.toLowerCase().replace(/\s+/g, ''); 

            let replyText = ""; 
            const args = originalMsg.split(/\s+/); 
            const command = args[0];

            // 🤖 ระบบดักจับแจ้งเตือนธนาคาร
            if (userMsg.includes('kdeposit')) {
                const match = originalMsg.match(/([0-9]+\.[0-9]{2})/);
                if (match) {
                    const bankAmount = parseFloat(match[1]);
                    let foundUserId = null;
                    for (let uId in global.depositQueue) {
                        const queue = global.depositQueue[uId];
                        if (queue.status === 'WAITING_ADMIN' && parseFloat(queue.displayAmount) === bankAmount) {
                            foundUserId = uId;
                            break;
                        }
                    }

                    if (foundUserId) {
                        const matchedQueue = global.depositQueue[foundUserId];
                        if (usersWallets[foundUserId]) {
                            usersWallets[foundUserId].balance += matchedQueue.rawAmount;
                            delete global.depositQueue[foundUserId];
                            if (Object.keys(global.depositQueue).length === 0) {
                                global.satangCounter = 0;
                            }
                            await saveDataToFirebase();
                        }
                    }
                }
                return res.sendStatus(200);
            }

            // 1. ระบบเติมเงิน/ลบเงิน
            if (command === "เติม" || command === "ลบ") {
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]); 
                    const amount = parseFloat(args[2]);      

                    if (!targetMemberId || isNaN(amount) || amount <= 0) {
                        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้อง\nกรุณาพิมพ์: เติม/ลบ [เลขสมาชิก] [จำนวนเงิน]`;
                    } else {
                        let foundUserKey = null;
                        for (let key in usersWallets) {
                            if (usersWallets[key].memberNumber === targetMemberId) {
                                foundUserKey = key;
                                break;
                            }
                        }

                        if (!foundUserKey) {
                            replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับ`;
                        } else {
                            if (command === "เติม") {
                                if (!global.depositQueue || !global.depositQueue[foundUserKey] || global.depositQueue[foundUserKey].status !== 'WAITING_ADMIN') {
                                    replyText = `❌ เติมเงินไม่สำเร็จ! สมาชิกยังไม่ได้พิมพ์ฝากเข้ามาในระบบ`;
                                } else {
                                    usersWallets[foundUserKey].balance += amount;
                                    const user = usersWallets[foundUserKey];
                                    delete global.depositQueue[foundUserKey]; 
                                    if (Object.keys(global.depositQueue).length === 0) global.satangCounter = 0;

                                    await saveDataToFirebase(); 
                                    replyText = `💰 เติมเครดิตสมาชิกที่ ${user.memberNumber} \n คุณ ${user.name} +${amount} สำเร็จ!\n──────────────────\nยอดสุทธิ: ${user.balance} บาท`;
                                }
                            } else if (command === "ลบ") {
                                usersWallets[foundUserKey].balance -= amount;
                                const user = usersWallets[foundUserKey];
                                await saveDataToFirebase(); 
                                replyText = `🚨 ลบยอดเครดิตสมาชิกที่ ${user.memberNumber} \n คุณ ${user.name} -${amount}!\n──────────────────\nยอดปัจจุบัน: ${user.balance} บาท`;
                            }
                        }
                    }
                }
            }
            // เติมติดโปร (B)
            else if (command === "B" || command === "b") {
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]);
                    const amount = parseFloat(args[2]); 

                    if (!targetMemberId || isNaN(amount) || amount <= 0) {
                        replyText = `⚠️ รูปแบบโปรโบนัสไม่ถูกต้อง\nกรุณาพิมพ์: B [เลขสมาชิก] [ยอดรวมรวมโบนัส]`;
                    } else {
                        let foundUserKey = null;
                        for (let key in usersWallets) {
                            if (usersWallets[key].memberNumber === targetMemberId) {
                                foundUserKey = key;
                                break;
                            }
                        }

                        if (!foundUserKey) {
                            replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับ`;
                        } else {
                            if (!global.depositQueue || !global.depositQueue[foundUserKey] || global.depositQueue[foundUserKey].status !== 'WAITING_ADMIN') {
                                replyText = `❌ เติมโบนัสไม่สำเร็จ! สมาชิกยังไม่ได้พิมพ์เปิดยอดฝากเข้ามาในระบบ`;
                            } else {
                                const user = usersWallets[foundUserKey];
                                user.balance += amount;
                                let newTurnoverTarget = amount * 20; 
                                let currentTurnover = user.turnoverTarget || 0;
                                user.turnoverTarget = currentTurnover + newTurnoverTarget;
                                
                                delete global.depositQueue[foundUserKey];
                                await saveDataToFirebase();

                                replyText = `🎁 เติมโบนัสให้สมาชิกที่ [ ${user.memberNumber} ] \n คุณ ${user.name} สำเร็จ!\n──────────────────\n` +
                                            `💰 ยอดสุทธิ: +${amount} บาท\n──────────────────\n` +
                                            `🔒 เงื่อนไข ต้องทำยอดเทิร์นสะสม เพิ่ม: +${newTurnoverTarget} บาท\n` +
                                            `📊 ยอดเทิร์นคงเหลือรวมทั้งหมด: ${user.turnoverTarget} บาท`;
                            }
                        }
                    }
                }
            }
            // ล้างยอดเทิร์น (bb)
            else if (command === "Bb" || command === "bb") {
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]);
                    if (!targetMemberId || isNaN(targetMemberId)) {
                        replyText = `⚠️ กรุณาพิมพ์: bb [เลขสมาชิก]`;
                    } else {
                        let foundUserKey = null;
                        for (let key in usersWallets) {
                            if (usersWallets[key].memberNumber === targetMemberId) {
                                foundUserKey = key;
                                break;
                            }
                        }

                        if (!foundUserKey) {
                            replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับ`;
                        } else {
                            const user = usersWallets[foundUserKey];
                            user.turnoverTarget = 0;
                            await saveDataToFirebase();

                            replyText = `🧼 [ระบบล้างยอดเทิร์นโอเวอร์] \n👤 คุณ ${user.name} (สมาชิกที่ ${user.memberNumber})\n✅ ล้างยอดเทิร์นเรียบร้อยแล้ว!`;
                        }
                    }
                }
            }
            // ยกเลิกคิวแจ้งฝาก (cc)
            else if (command === "cc" || command === "Cc" || command === "CC") {
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]);
                    if (!targetMemberId || isNaN(targetMemberId)) {
                        replyText = "❌ พิมพ์เช่น: cc [เลขสมาชิก]";
                    } else {
                        let foundUserKey = null;
                        if (global.depositQueue) {
                            for (let key in global.depositQueue) {
                                if (global.depositQueue[key].memberId === targetMemberId) {
                                    foundUserKey = key;
                                    break;
                                }
                            }
                        }

                        if (foundUserKey) {
                            delete global.depositQueue[foundUserKey];
                            replyText = `❌ ยกเลิกคิวฝากของ สมาชิกลำดับที่: ${targetMemberId} เรียบร้อยแล้วครับ`;
                        } else {
                            replyText = `❌ ไม่พบรายการคิวฝากที่ตรงกับสมาชิกลำดับที่ ${targetMemberId}`;
                        }
                    }
                }
            }
            // เติมเครดิตฉุกเฉิน (@)
            else if (command === "@") {
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]);
                    let rawAmountStr = args[2] ? args[2].toString() : "";      

                    if (!targetMemberId || !rawAmountStr) {
                        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้อง\n@ [เลขสมาชิก] [จำนวนเงิน] หรือ @ [เลขสมาชิก] [จำนวนเงิน]#[ยอดเทิร์น]`;
                    } else {
                        let amount = 0;
                        let turnoverRequirement = 0;

                        if (rawAmountStr.includes('#')) {
                            const parts = rawAmountStr.split('#');
                            amount = parseFloat(parts[0]);
                            turnoverRequirement = parseFloat(parts[1]);
                        } else {
                            amount = parseFloat(rawAmountStr);
                        }

                        if (isNaN(amount) || amount <= 0 || isNaN(turnoverRequirement) || turnoverRequirement < 0) {
                            replyText = `⚠️ จำนวนเงิน หรือยอดเทิร์นโอเวอร์ไม่ถูกต้อง`;
                        } else {
                            let foundUserKey = null;
                            for (let key in usersWallets) {
                                if (usersWallets[key].memberNumber === targetMemberId) {
                                    foundUserKey = key;
                                    break;
                                }
                            }

                            if (!foundUserKey) {
                                replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับ`;
                            } else {
                                usersWallets[foundUserKey].balance += amount;
                                if (turnoverRequirement > 0) {
                                    let currentTurnover = usersWallets[foundUserKey].turnoverTarget || 0;
                                    usersWallets[foundUserKey].turnoverTarget = currentTurnover + turnoverRequirement;
                                }

                                const user = usersWallets[foundUserKey];
                                await saveDataToFirebase(); 
                                replyText = `⚡ [จัดการเครดิตแอดมิน]\n👤 คุณ ${user.name} (สมาชิกที่ ${user.memberNumber})\n💰 ได้รับเครดิต: +${amount} บาท\n💰 ยอดเงินปัจจุบัน: ${user.balance} บาท`;
                            }
                        }
                    }
                }
            }
            // แจ้งฝากเงิน
            else if (userMsg.startsWith("ฝาก")) {
                const amount = parseInt(userMsg.replace('ฝาก', '').trim());
                if (!amount || isNaN(amount) || amount <= 0) {
                    replyText = "⚠️ พิมพ์ระบุจำนวนเงินด้วยครับ เช่น ฝาก 500";
                } else {
                    const walletData = usersWallets[userId];
                    if (!walletData) {
                        replyText = "⚠️ กรุณาลงทะเบียนเป็นสมาชิกก่อนฝากเงินครับ";
                    } else {
                        if (!global.depositQueue) global.depositQueue = {};
                        const currentQueue = global.depositQueue[userId];

                        if (currentQueue && currentQueue.status === 'WAITING_ADMIN') {
                            replyText = `⚠️ มีรายการแจ้งฝากค้างอยู่ในระบบ ยอดที่ต้องโอน: ${currentQueue.displayAmount} บาท`;
                        } else {
                            global.satangCounter = (global.satangCounter % 99) + 1;
                            const satangValue = global.satangCounter / 100;
                            const totalWithSatang = amount + satangValue;
                            const displayAmount = totalWithSatang.toFixed(2);

                            const generatePayload = require('promptpay-qr');
                            const promptpayNumber = "004999031203416"; 
                            const payload = generatePayload(promptpayNumber, { amount: Number(displayAmount) });
                            const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(payload)}`;

                            global.depositQueue[userId] = {
                                memberId: walletData.memberNumber,
                                name: walletData.name || 'ไม่ระบุชื่อ',
                                rawAmount: amount,
                                displayAmount: displayAmount,
                                status: 'WAITING_ADMIN'
                            };

                            const nickname = walletData.nickname || walletData.name || 'สมาชิก';
                            const memberId = walletData.memberNumber || walletData.memberId || '-';

                            try {
                                await axios.post('https://api.line.me/v2/bot/message/reply', {
                                    replyToken: replyToken,
                                    messages: [{
                                        "type": "flex",
                                        "altText": `📥 ใบสั่งฝากเครดิต ยอดโอน: ${displayAmount} บาท`,
                                        "contents": {
                                            "type": "bubble",
                                            "styles": { "body": { "backgroundColor": "#09120e" } },
                                            "body": {
                                                "type": "box",
                                                "layout": "vertical",
                                                "spacing": "md",
                                                "contents": [
                                                    { "type": "text", "text": "📥 ใบสั่งรายการฝากเงิน", "weight": "bold", "color": "#00ff88", "size": "md", "align": "center" },
                                                    {
                                                        "type": "box",
                                                        "layout": "horizontal",
                                                        "backgroundColor": "#0f1f17",
                                                        "paddingAll": "sm",
                                                        "contents": [
                                                            { "type": "text", "text": `👤 คุณ: ${nickname}`, "size": "xs", "color": "#ffffff", "weight": "bold" },
                                                            { "type": "text", "text": `ID: ${memberId}`, "size": "xs", "color": "#00ff88", "align": "end", "weight": "bold" }
                                                        ]
                                                    },
                                                    { "type": "separator", "color": "#12251c" },
                                                    {
                                                        "type": "box",
                                                        "layout": "vertical",
                                                        "spacing": "xs",
                                                        "contents": [
                                                            { "type": "text", "text": "💸 กรุณาโอนเงินยอดสุทธิ:", "size": "xs", "color": "#8caf9c" },
                                                            { "type": "text", "text": `${displayAmount} บาท`, "size": "xxl", "color": "#00ff88", "weight": "bold", "align": "center", "margin": "sm" },
                                                            { "type": "text", "text": "(กรุณาโอนเศษสตางค์ให้ตรงเพื่ออัปยอดไวที่สุด)", "size": "10px", "color": "#ffaa00", "align": "center" }
                                                        ]
                                                    },
                                                    {
                                                        "type": "image",
                                                        "url": qrCodeUrl,
                                                        "size": "4xl",
                                                        "aspectRatio": "1:1",
                                                        "aspectMode": "fit",
                                                        "margin": "md"
                                                    },
                                                    { "type": "separator", "color": "#12251c" },
                                                    { "type": "text", "text": "👤 ชื่อบัญชี: นาย ภาณุวัฒก์ ก้องกุล", "size": "xs", "color": "#ffffff", "align": "center", "weight": "bold" },
                                                    { "type": "separator", "color": "#12251c" },
                                                    { "type": "text", "text": "⚠️ โอนตามยอดที่มีเศษสตางค์ แล้วส่งสลิปเพื่อยืนยันรายการได้เลยครับ", "size": "11px", "color": "#ff4444", "wrap": true, "align": "center", "weight": "bold" }
                                                ]
                                            }
                                        }
                                    }]
                                }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                                return res.sendStatus(200);
                            } catch (err) { 
                                console.error("Error deposit flex:", err); 
                            }
                        }
                    }
                }
            }
            // เช็กรายการรอถอนเงิน (ชถ)
            else if (userMsg.trim() === 'ชถ') {
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    if (withdrawQueue.length === 0) {
                        replyText = "🎉 [ระบบคิวถอน] ไม่มีรายการค้างถอนในขณะนี้ครับ!";
                    } else {
                        let queueText = "📋 [รายการรอถอนเงินทั้งหมด] 📋\n────────────────\n";
                        withdrawQueue.forEach((item, index) => {
                            queueText += `${index + 1}. 👤 สมาชิกคนที่: ${item.memberNumber}\n`;
                            queueText += `   📛 ชื่อ: คุณ ${item.name}\n`;
                            queueText += `   💰 ยอดถอน: ${item.amount} บาท\n`;
                            queueText += `   🕒 เวลา: ${item.time} น.\n────────────────\n`;
                        });
                        replyText = queueText;
                    }
                }
            }    
            // แอดมิน เปิด/ปิดรอบแทง (o / x / rst)
            else if (userMsg === 'o' || userMsg === 'x' || userMsg === 'rst') {
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const openRoundImgUrl = "https://img2.pic.in.th/-__-----4b1c38e0628ea626.jpg"; 
                    const closeRoundImgUrl = "https://img2.pic.in.th/-__-----2cccaadd8f93c70b.jpg";

                    if (userMsg === 'o') {
                        if (isRoundOpen) {
                            replyText = `⚠️ ตอนนี้ระบบกำลังเปิด "รอบที่ ${currentRound}" อยู่แล้วครับ`;
                        } else {
                            currentRound++;
                            isRoundOpen = true;
                            roundBets = {}; 
                            await saveDataToFirebase();
                            
                            let historyFlexContents = [];
                            if (matchHistory && matchHistory.length > 0) {
                                historyFlexContents = matchHistory.map(item => ({
                                    "type": "text",
                                    "text": typeof item === 'object' ? JSON.stringify(item) : item,
                                    "size": "xs",
                                    "color": "#E2E1E4",
                                    "wrap": true
                                }));
                            } else {
                                historyFlexContents.push({
                                    "type": "text",
                                    "text": "• ยังไม่มีข้อมูลสถิติย้อนหลังในรอบนี้",
                                    "size": "xs",
                                    "color": "#E2E1E4",
                                    "style": "italic",
                                    "align": "center"
                                });
                            }

                            try {
                                await axios.post('https://api.line.me/v2/bot/message/reply', {
                                    replyToken: replyToken,
                                    messages: [
                                        { "type": "image", "originalContentUrl": openRoundImgUrl, "previewImageUrl": openRoundImgUrl },
                                        {
                                            "type": "flex",
                                            "altText": `🟢 เริ่มเปิดรอบแทงแล้ว! รอบที่ ${currentRound}`,
                                            "contents": {
                                                "type": "bubble",
                                                "styles": { "body": { "backgroundColor": "#1A1A1A" } },
                                                "body": {
                                                    "type": "box", "layout": "vertical", "spacing": "md",
                                                    "contents": [
                                                        { "type": "text", "text": "🎰 เริ่มเปิดรอบแทงแล้วครับ 🎉", "weight": "bold", "color": "#66FF00", "size": "md", "align": "center" },
                                                        { "type": "text", "text": `รอบที่: ${currentRound}`, "weight": "bold", "color": "#ffffff", "size": "xl", "align": "center" },
                                                        { "type": "separator", "color": "#22031F" },
                                                        { "type": "text", "text": "📈 สถิติผลเจ้ามือ 5 รอบล่าสุด", "size": "xs", "color": "#66FF00", "weight": "bold" },
                                                        { "type": "box", "layout": "vertical", "spacing": "xs", "contents": historyFlexContents },
                                                        { "type": "separator", "color": "#1f3a2b" },
                                                        { "type": "text", "text": "✨ สมาชิกสามารถส่งโพยเข้ามาได้เลยครับ 🎰", "size": "sm", "color": "#ffffff", "wrap": true, "align": "center", "weight": "bold" }
                                                    ]
                                                }
                                            }
                                        }
                                    ]
                                }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                            } catch (error) {
                                console.error("❌ เปิดรอบล้มเหลว:", error.message);
                            }
                            return; 
                        }
                    } else if (userMsg === 'x') {
                        if (!isRoundOpen) {
                            replyText = `⚠️ ระบบปิดรอบแทงอยู่แล้วครับ`;
                        } else {
                            isRoundOpen = false;
                            await saveDataToFirebase();
                            
                            let summaryFlexContents = [];
                            let hasAnyBet = false;

                            const formatLegDisplay = (bet) => {
                                if (!bet || !bet.betType) return "ไม่ระบุขา";
                                const type = bet.betType;
                                const price = bet.pricePerLeg || 0;
                                if (type === "รข") return `เหมาขวา (${price}/ขา)`;
                                if (type === "รจ") return `เหมาเจ้า (${price}/ขา)`;
                                if (type.startsWith('จ')) return `แทงเจ้าสู้ขา ${type.substring(1).split('').join(', ')} (${price}/ขา)`;
                                return `ขา ${type.split('').join(', ')} (${price}/ขา)`;
                            };

                            for (let uId in roundBets) {
                                const userBetsArray = roundBets[uId];
                                if (!userBetsArray || userBetsArray.length === 0) continue;

                                hasAnyBet = true;
                                const user = usersWallets[uId] || {};
                                const displayName = user.nickname || user.name || "สมาชิก";
                                let userTotalBetAmt = 0;
                                let legsList = [];

                                userBetsArray.forEach((b) => {
                                    if (b.actualBet) userTotalBetAmt += b.actualBet;
                                    legsList.push(formatLegDisplay(b));
                                });

                                summaryFlexContents.push({
                                    "type": "box",
                                    "layout": "vertical",
                                    "margin": "md",
                                    "contents": [
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "contents": [
                                                { "type": "text", "text": `• [ ${user.memberNumber || '-'} ] ${displayName}`, "size": "sm", "color": "#ffffff", "weight": "bold", "flex": 5, "wrap": true },
                                                { "type": "text", "text": `${userTotalBetAmt} ฿`, "size": "sm", "color": "#ffaa00", "align": "end", "weight": "bold", "flex": 3 }
                                            ]
                                        },
                                        { "type": "text", "text": `   🎯 ขาที่ลง: ${legsList.join(', ')}`, "size": "xs", "color": "#aaaaaa", "wrap": true, "margin": "xs" }
                                    ]
                                });
                            }

                            if (!hasAnyBet) {
                                summaryFlexContents.push({ "type": "text", "text": "• ไม่มีสมาชิกส่งโพยเดิมพันในรอบนี้", "size": "sm", "color": "#888888", "style": "italic", "align": "center" });
                            }

                            try {
                                const chunkSize = 5;
                                const flexPages = [];
                                for (let i = 0; i < summaryFlexContents.length; i += chunkSize) {
                                    flexPages.push(summaryFlexContents.slice(i, i + chunkSize));
                                }
                                if (flexPages.length === 0) flexPages.push([{ "type": "text", "text": "ไม่มีรายการแทงในรอบนี้", "color": "#aaaaaa", "size": "xs", "align": "center" }]);

                                const carouselBubbles = flexPages.map((pageContents, index) => ({
                                    "type": "bubble",
                                    "styles": { "body": { "backgroundColor": "#1A1A1A" } },
                                    "body": {
                                        "type": "box", "layout": "vertical", "spacing": "md",
                                        "contents": [
                                            { "type": "text", "text": "🚫 ปิดรอบแทงเรียบร้อยแล้วครับ 🏁", "weight": "bold", "color": "#E9100F", "size": "md", "align": "center" },
                                            { "type": "text", "text": `จบรอบที่: ${currentRound} (หน้า ${index + 1}/${flexPages.length})`, "weight": "bold", "color": "#ffffff", "size": "sm", "align": "center" },
                                            { "type": "separator", "color": "#3a2222" },
                                            { "type": "text", "text": "📝 สรุปยอดแทงประจำรอบ", "size": "xs", "color": "#FFCE00", "weight": "bold" },
                                            { "type": "box", "layout": "vertical", "spacing": "xs", "contents": pageContents },
                                            { "type": "separator", "color": "#3a2222" },
                                            { "type": "text", "text": "🔒 หยุดรับโพยทุกกรณี รอแอดมินส่งผล", "size": "sm", "color": "#E9100F", "wrap": true, "align": "center", "weight": "bold" }
                                        ]
                                    }
                                }));

                                await axios.post('https://api.line.me/v2/bot/message/reply', {
                                    replyToken: replyToken,
                                    messages: [
                                        { "type": "image", "originalContentUrl": closeRoundImgUrl, "previewImageUrl": closeRoundImgUrl },
                                        { "type": "flex", "altText": `🚫 ปิดรอบแทงเรียบร้อย รอบที่ ${currentRound}`, "contents": { "type": "carousel", "contents": carouselBubbles } }
                                    ]
                                }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                            } catch (error) {
                                console.error("❌ ปิดรอบล้มเหลว:", error.message);
                            }
                            return;
                        }
                    } else if (userMsg === 'rst') {
                        currentRound = 0;
                        isRoundOpen = false;
                        roundBets = {};
                        usersRoundCrossCheck = {};
                        matchHistory = []; 
                        pastRoundsData = {};

                        await saveDataToFirebase(); 
                        replyText = "🔄 ทำการล้างลำดับรอบเรียบร้อยแล้ว! เริ่มต้นที่ รอบที่ 1 ครับ ⚙️";
                    }
                }
            }
            // 4. ระบบรับโพยป๊อกเด้ง (2 ใบ)
            else if (originalMsg.includes('-') && !originalMsg.startsWith('C/') && !originalMsg.startsWith('c/')) {
                if (!isRoundOpen) {
                    replyText = "🚫 ตอนนี้ระบบปิดรับโพยชั่วคราวครับ กรุณารอแอดมินเปิดรอบใหม่";
                } else {
                    const user = usersWallets[userId];
                    if (!user) {
                        replyText = `📢 ยินดีต้อนรับสมาชิกใหม่! กรุณาพิมพ์: C/ชื่อ-นามสกุล เพื่อสมัครสมาชิกก่อนครับ`;
                    } else {
                        const displayName = user.nickname || user.name || "ไม่ระบุชื่อ";

                        if (user.isWithdrawLocked) {
                            replyText = `❌ คุณไม่สามารถส่งโพยแทงได้ครับ! อยู่ระหว่าง "รออนุมัติยอดถอน" (${user.pendingWithdrawAmount} บาท)`;
                        } else {
                            const lines = originalMsg.split(/\r?\n/);
                            let totalActualBet = 0; 
                            let totalHoldCost = 0;
                            let processedBets = [];
                            let hasError = false;
                            let errorMsg = "";

                            if (!roundBets[userId] || roundBets[userId].length === 0) {
                                usersRoundCrossCheck[userId] = {}; 
                            }
                            if (!usersRoundCrossCheck[userId]) usersRoundCrossCheck[userId] = {};
                            let betTracker = usersRoundCrossCheck[userId];

                            const allowedLegs = ['1', '2', '3', '4', '5', '6'];
                            const MIN_BET = 10;
                            const MAX_BET = 2500;

                            for (let line of lines) {
                                let cleanLine = line.trim().toLowerCase();
                                if (cleanLine === "") continue;

                                const parts = cleanLine.split('-');
                                if (parts.length !== 2) {
                                    hasError = true;
                                    errorMsg = `⚠️ รูปแบบโพยไม่ถูกต้อง: "${line}" (ตัวอย่าง: 1-100 หรือ 123-100)`;
                                    break;
                                }

                                const targetStr = parts[0].trim();
                                const price = parseFloat(parts[1].trim());

                                if (isNaN(price) || price <= 0) {
                                    hasError = true;
                                    errorMsg = `⚠️ จำนวนเงินไม่ถูกต้อง: "${line}"`;
                                    break;
                                }

                                if (price < MIN_BET || price > MAX_BET) {
                                    hasError = true;
                                    errorMsg = `❌ ยอดแทงต่อขาต้องอยู่ระหว่าง ${MIN_BET} ถึง ${MAX_BET} บาทครับ`;
                                    break;
                                }

                                let legsCount = 0;
                                let betTypeDetail = "";

                                if (targetStr === "รข") {
                                    legsCount = 6;
                                    betTypeDetail = `เหมาขาผู้เล่นสู้เจ้ามือ (6 ขา) ขาละ ${price} บาท`;
                                    for (let c = 1; c <= 6; c++) {
                                        if (betTracker[c] && betTracker[c] === 'dealer') {
                                            hasError = true; errorMsg = `❌ แทง รข ไม่ได้! ขา ${c} มีการแทงฝั่งเจ้ามือค้างไว้`; break;
                                        }
                                    }
                                    if (hasError) break; 
                                    for (let c = 1; c <= 6; c++) betTracker[c] = 'player';
                                } else if (targetStr === "รจ") {
                                    legsCount = 6;
                                    betTypeDetail = `แทงเจ้ามือสู้ทุกขา (6 ขา) ขาละ ${price} บาท`;
                                    for (let c = 1; c <= 6; c++) {
                                        if (betTracker[c] && betTracker[c] === 'player') {
                                            hasError = true; errorMsg = `❌ แทง รจ ไม่ได้! ขา ${c} มีการแทงฝั่งผู้เล่นค้างไว้`; break;
                                        }
                                    }
                                    if (hasError) break; 
                                    for (let c = 1; c <= 6; c++) betTracker[c] = 'dealer';
                                } else if (targetStr.startsWith('จ')) {
                                    const legs = targetStr.substring(1);
                                    if (legs === "") { hasError = true; errorMsg = `⚠️ ไม่ระบุเลขขาเจ้ามือ: "${line}"`; break; }

                                    let isLegsValid = legs.split('').every(char => allowedLegs.includes(char));
                                    if (!isLegsValid) { hasError = true; errorMsg = `❌ ห้องนี้มีแค่ ขา 1 ถึง ขา 6 เท่านั้นครับ`; break; }
                                    
                                    legsCount = legs.length;
                                    betTypeDetail = `เจ้ามือสู้ขา [${legs.split('').join(', ')}] ขาละ ${price} บาท`;
                                    for (let c of legs.split('')) {
                                        if (betTracker[c] && betTracker[c] === 'player') {
                                            hasError = true; errorMsg = `❌ แทงสวนไม่ได้! ขา ${c} แทงฝั่งผู้เล่นไปแล้ว`; break;
                                        }
                                    }
                                    if (hasError) break;
                                    for (let c of legs.split('')) betTracker[c] = 'dealer';
                                } else {
                                    let isLegsValid = targetStr.split('').every(char => allowedLegs.includes(char));
                                    if (!isLegsValid) { hasError = true; errorMsg = `❌ ห้องนี้มีแค่ ขา 1 ถึง ขา 6 เท่านั้นครับ`; break; }
                                    legsCount = targetStr.length;
                                    betTypeDetail = `แทงขา [${targetStr.split('').join(', ')}] ขาละ ${price} บาท`;
                                    for (let c of targetStr.split('')) {
                                        if (betTracker[c] && betTracker[c] === 'dealer') {
                                            hasError = true; errorMsg = `❌ แทงสวนไม่ได้! ขา ${c} แทงฝั่งเจ้ามือไปแล้ว`; break;
                                        }
                                    }
                                    if (hasError) break;
                                    for (let c of targetStr.split('')) betTracker[c] = 'player';
                                }

                                let currentLineBet = price * legsCount;
                                let currentLineHold = currentLineBet * 2; // ค้ำประกัน 3 เด้ง (ยอดแทง + 2 เท่า)

                                totalActualBet += currentLineBet;
                                totalHoldCost += currentLineHold;

                                processedBets.push({
                                    betType: targetStr,
                                    detail: betTypeDetail,
                                    actualBet: currentLineBet,
                                    holdCost: currentLineHold,
                                    pricePerLeg: price,
                                    memberNumber: user.memberNumber,
                                    name: user.name
                                });
                            }

                            if (hasError) {
                                replyText = errorMsg;
                            } else if (user.balance < totalHoldCost) {
                                replyText = `❌ เครดิตไม่พอสำหรับค้ำประกัน!\nยอดเดิมพัน: ${totalActualBet} ฿ | ต้องใช้ค้ำประกัน: ${totalHoldCost} ฿\nเครดิตคุณมี: ${user.balance} ฿`;
                            } else {
                                user.balance -= totalHoldCost;
                                if (!roundBets[userId]) roundBets[userId] = [];
                                roundBets[userId].push(...processedBets);

                                await saveDataToFirebase();
                                replyText = `✅ บันทึกโพยเรียบร้อย!\n👤 คุณ ${displayName} (ID: ${user.memberNumber})\n💰 ยอดแทงรวม: ${totalActualBet} บาท (หักค้ำ: ${totalHoldCost} บาท)\n💳 เครดิตคงเหลือ: ${user.balance} บาท`;
                            }
                        }
                    }
                }
            }
            // 5. คืนโพย (r)
            else if (userMsg === "r") {
                if (!isRoundOpen) {
                    replyText = "🚫 ไม่สามารถคืนโพยได้ เนื่องจากปิดรอบแทงเรียบร้อยแล้ว";
                } else {
                    const user = usersWallets[userId];
                    if (!user) {
                        replyText = `📢 คุณยังไม่ได้ลงทะเบียนสมาชิกครับ`;
                    } else {
                        const myBets = roundBets[userId];
                        if (!myBets || myBets.length === 0) {
                            replyText = `❌ คุณ ${user.name} ไม่มีรายการโพยค้างในรอบนี้ครับ`;
                        } else {
                            const totalRefund = myBets.reduce((sum, bet) => sum + bet.holdCost, 0);
                            user.balance += totalRefund;
                            usersRoundCrossCheck[userId] = {};
                            roundBets[userId] = []; 

                            await saveDataToFirebase();

                            try {
                                await axios.post('https://api.line.me/v2/bot/message/reply', {
                                    replyToken: replyToken,
                                    messages: [{
                                        "type": "flex",
                                        "altText": "🗑️ ยกเลิกโพยสำเร็จเรียบร้อยแล้ว",
                                        "contents": {
                                            "type": "bubble",
                                            "styles": { "body": { "backgroundColor": "#141414" } },
                                            "body": {
                                                "type": "box", "layout": "vertical", "spacing": "md",
                                                "contents": [
                                                    { "type": "text", "text": "🗑️ ยกเลิกโพยสำเร็จเรียบร้อย 🎉", "weight": "bold", "color": "#ff3333", "size": "md", "align": "center" },
                                                    { "type": "separator", "color": "#333333" },
                                                    { "type": "text", "text": `👤 สมาชิก: ${user.name} (ID: ${user.memberNumber})`, "size": "sm", "color": "#ffffff", "weight": "bold" },
                                                    { "type": "text", "text": `💰 คืนเครดิต: +${totalRefund} บาท | เครดิตใหม่: ${user.balance} บาท`, "size": "sm", "color": "#00ff00" }
                                                ]
                                            }
                                        }
                                    }]
                                }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                            } catch (error) {
                                console.error("❌ คืนโพยล้มเหลว:", error.message);
                            }
                            return; 
                        }
                    }
                }
            }
            // ==================== [ 8. ส่งผลสรุปไพ่ 2 ใบ (>ขา1 ขา2 ... เจ้ามือ) ] ====================
            else if (originalMsg.startsWith('>')) {
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else if (isRoundOpen) {
                    replyText = "⚠️ ต้องพิมพ์ปิดรอบแทง (X) ก่อน จึงจะสรุปผลได้ครับ";
                } else {
                    let textWithoutArrow = originalMsg.substring(1).trim();
                    const parts = textWithoutArrow.split(/\s+/);
                    
                    if (parts.length < 2) {
                        replyText = "⚠️ รูปแบบผิด! พิมพ์เรียง ขา1 ขา2 ... และตัวสุดท้ายคือเจ้ามือ";
                        return res.sendStatus(200);
                    }

                    // 🛠️ แกะรหัสไพ่ (ระบบไพ่ 2 ใบ)
                    const parseCardStr = (str, isDealer = false) => {
                        let clean = str.trim().toLowerCase();
                        let isPok = false; 
                        let multiplier = 1; 
                        let typeName = "แต้มปกติ";
                        let rawScore = 0;

                        const slashCount = (clean.match(/\//g) || []).length;
                        if (slashCount === 2) multiplier = 3;
                        else if (slashCount === 1) multiplier = 2;
                        
                        clean = clean.replace(/\//g, '');

                        if (isDealer && clean.includes('*')) { isPok = true; clean = clean.replace('*', ''); }

                        if (clean === 'sf') { rawScore = 600; multiplier = 5; typeName = "สเตฟฟลัช"; } 
                        else if (clean === 'h') { rawScore = 500; multiplier = 3; typeName = "เซียน/3เหลือง"; } 
                        else if (clean === 's' || clean === 'ร') { rawScore = 400; multiplier = 3; typeName = "เรียง"; } 
                        else {
                            let pts = parseInt(clean);
                            if (isNaN(pts)) pts = 0;
                            
                            if (isPok || pts === 8 || pts === 9) {
                                if (pts === 9) { rawScore = 900; typeName = "ป๊อก 9"; }
                                else if (pts === 8) { rawScore = 800; typeName = "ป๊อก 8"; }
                                else { rawScore = pts; typeName = `${pts} แต้ม`; }
                            } else {
                                rawScore = pts; typeName = `${pts} แต้ม`;
                            }
                        }
                        return { score: rawScore, v: clean, mult: multiplier, name: typeName };
                    };

                    const dealerRawStr = parts[parts.length - 1]; 
                    const dealerResult = parseCardStr(dealerRawStr, true);

                    let roomResults = {}; 
                    const totalLegsToSend = Math.min(parts.length - 1, 6);

                    for (let i = 0; i < totalLegsToSend; i++) {
                        let innerContent = parts[i].trim();
                        if (innerContent === "") continue;

                        let currentLeg = i + 1;
                        let legResult = parseCardStr(innerContent, false);

                        roomResults[currentLeg] = {
                            leg: currentLeg,
                            card: legResult
                        };
                    }
                    
                    tempRoomResults = roomResults;
                    tempDealerResult = dealerResult;

                    let legsFlexContents = [];
                    for (let leg = 1; leg <= 6; leg++) {
                        if (roomResults[leg]) {
                            const res = roomResults[leg];
                            let statusStr = "เสมอ 🟡"; let statusColor = "#ffcc00";

                            if (res.card.score > dealerResult.score) { statusStr = "ชนะ 🟢"; statusColor = "#00ff66"; }
                            else if (res.card.score < dealerResult.score) { statusStr = "แพ้ 🔴"; statusColor = "#ff3333"; }

                            legsFlexContents.push({
                                "type": "box",
                                "layout": "vertical",
                                "margin": "md",
                                "spacing": "xs",
                                "contents": [
                                    { "type": "text", "text": `🃏 ขาที่ ${leg}`, "weight": "bold", "color": "#ffffff", "size": "sm" },
                                    {
                                        "type": "box",
                                        "layout": "horizontal",
                                        "contents": [
                                            { "type": "text", "text": `• ผลไพ่: ${res.card.name} (${res.card.mult}เด้ง)`, "size": "xs", "color": "#cccccc" },
                                            { "type": "text", "text": statusStr, "size": "xs", "color": statusColor, "align": "end", "weight": "bold" }
                                        ]
                                    },
                                    { "type": "separator", "color": "#2a2233", "margin": "xs" }
                                ]
                            });
                        } else {
                            legsFlexContents.push({
                                "type": "box",
                                "layout": "horizontal",
                                "margin": "xs",
                                "contents": [
                                    { "type": "text", "text": `🃏 ขาที่  ${leg}: ⚠️ ไม่มีผลไพ่`, "size": "xs", "color": "#888888", "style": "italic" },
                                    { "type": "text", "text": "แพ้ 🔴", "size": "xs", "color": "#ff3333", "align": "end", "weight": "bold" }
                                ]
                            });
                        }
                    }

                    const summaryImgUrl = "https://img2.pic.in.th/-__-----4b1c38e0628ea626.jpg";

                    try {
                        await axios.post('https://api.line.me/v2/bot/message/reply', {
                            replyToken: replyToken,
                            messages: [
                                { "type": "image", "originalContentUrl": summaryImgUrl, "previewImageUrl": summaryImgUrl },
                                {
                                    "type": "flex",
                                    "altText": `📊 ตรวจสอบผลการเล่น รอบที่ ${currentRound}`,
                                    "contents": {
                                        "type": "bubble",
                                        "styles": { "body": { "backgroundColor": "#130f17" } },
                                        "body": {
                                            "type": "box", "layout": "vertical", "spacing": "md",
                                            "contents": [
                                                { "type": "text", "text": "📊 ตรวจสอบผลการเล่นผลคะแนน 🎰", "weight": "bold", "color": "#b8860b", "size": "md", "align": "center" },
                                                { "type": "text", "text": `รอบที่: ${currentRound}`, "weight": "bold", "color": "#ffffff", "size": "sm", "align": "center" },
                                                { "type": "separator", "color": "#2a2233" },
                                                {
                                                    "type": "box", "layout": "horizontal", "backgroundColor": "#221929",
                                                    "contents": [
                                                        { "type": "text", "text": "👑 เจ้ามือ:", "weight": "bold", "color": "#ffaa00", "size": "sm" },
                                                        { "type": "text", "text": `${dealerResult.name} (${dealerResult.mult} เด้ง)`, "weight": "bold", "color": "#ffffff", "size": "sm", "align": "end" }
                                                    ]
                                                },
                                                { "type": "separator", "color": "#2a2233" },
                                                { "type": "text", "text": "📝 ลำดับหน้าไพ่และผลแพ้ชนะแต่ละขา", "size": "xs", "color": "#ffaa00", "weight": "bold" },
                                                { "type": "box", "layout": "vertical", "spacing": "xs", "contents": legsFlexContents },
                                                { "type": "separator", "color": "#2a2233" },
                                                {
                                                    "type": "box", "layout": "horizontal", "spacing": "sm", "margin": "md",
                                                    "contents": [
                                                        { "type": "button", "style": "primary", "color": "#00c853", "height": "sm", "action": { "type": "message", "label": "✅ ยืนยัน", "text": "ok" } },
                                                        { "type": "button", "style": "primary", "color": "#d32f2f", "height": "sm", "action": { "type": "message", "label": "❌ ยกเลิก", "text": "no" } }
                                                    ]
                                                }
                                            ]
                                        }
                                    }
                                }
                            ]
                        }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                    } catch (error) {
                        console.error("❌ สรุปผลล้มเหลว:", error.message);
                    }
                    return res.sendStatus(200);
                }
            }
            // ==================== [ 9. ยืนยันผลคำนวณเงิน OK / NO (ไพ่ 2 ใบ) ] ====================
            else if (userMsg === 'ok' || userMsg === 'no') {
                if (!ADMIN_IDS.includes(userId)) return;

                if (!tempRoomResults || !tempDealerResult) {
                    replyText = "⚠️ ไม่มีข้อมูลผลแต้มค้างอยู่ในระบบ กรุณาส่งผลแต้มด้วยเครื่องหมาย > ก่อนครับ";
                } else {
                    if (userMsg === 'ok') {
                        let hasAnyBet = false;
                        let flexUserContents = [];

                        for (let uId in roundBets) {
                            try {
                                const userBetsArray = roundBets[uId];
                                if (!userBetsArray || userBetsArray.length === 0) continue;
                                    
                                const user = usersWallets[uId];
                                if (!user) continue;

                                const displayName = user.nickname || user.name || "สมาชิก";
                                hasAnyBet = true;
                                let userTotalWinLoss = 0; 
                                let totalHoldRefund = 0;   
                                let totalBetAmountThisRound = 0;

                                userBetsArray.forEach((bet) => {
                                    totalHoldRefund += bet.holdCost;

                                    let legsToCalculate = [];
                                    if (bet.betType === "รข" || bet.betType === "รจ") {
                                        legsToCalculate = ['1', '2', '3', '4', '5', '6'];
                                    } else if (bet.betType.startsWith('จ')) {
                                        legsToCalculate = bet.betType.substring(1).split('');
                                    } else {
                                        legsToCalculate = bet.betType.split('');
                                    }

                                    totalBetAmountThisRound += (bet.pricePerLeg * legsToCalculate.length);

                                    legsToCalculate.forEach((leg) => {
                                        const legNum = parseInt(leg);
                                        const matchResult = tempRoomResults[legNum];
                                        if (!matchResult) return;
                                        
                                        const isBettingOnDealer = (bet.betType === "รจ" || bet.betType.startsWith('จ'));
                                        const betPrice = bet.pricePerLeg;
                                        const finalCard = matchResult.card;

                                        if (!isBettingOnDealer) {
                                            if (finalCard.score > tempDealerResult.score) {
                                                userTotalWinLoss += (betPrice * finalCard.mult);
                                            } else if (finalCard.score < tempDealerResult.score) {
                                                let loseMult = tempDealerResult.mult > 3 ? 3 : tempDealerResult.mult;
                                                userTotalWinLoss -= (betPrice * loseMult);
                                            }
                                        } else {
                                            if (tempDealerResult.score > finalCard.score) {
                                                let winMult = tempDealerResult.mult;
                                                let grossWin = betPrice * winMult;
                                                let netWin = Math.floor(grossWin * 0.9); // หักต๋ง 10%
                                                userTotalWinLoss += netWin;
                                            } else if (tempDealerResult.score < finalCard.score) {
                                                let loseMult = finalCard.mult > 3 ? 3 : finalCard.mult;
                                                userTotalWinLoss -= (betPrice * loseMult);
                                            }
                                        }
                                    });
                                });

                                user.balance = user.balance + totalHoldRefund + userTotalWinLoss;

                                if (user.turnoverTarget > 0 && userTotalWinLoss !== 0) {
                                    user.turnoverTarget -= totalBetAmountThisRound;
                                    if (user.turnoverTarget < 0) user.turnoverTarget = 0; 
                                }

                                let sign = userTotalWinLoss > 0 ? "+" : "";
                                let displayColor = userTotalWinLoss > 0 ? "#00ff66" : (userTotalWinLoss < 0 ? "#ff3333" : "#ffcc00");

                                flexUserContents.push({
                                    "type": "box",
                                    "layout": "vertical",
                                    "margin": "md",
                                    "spacing": "xs",
                                    "contents": [
                                        { "type": "text", "text": `👤 [ ${user.memberNumber || '-'} ] ${displayName}`, "weight": "bold", "color": "#ffffff", "size": "sm" },
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "contents": [
                                                { "type": "text", "text": `• ยอดสุทธิ:`, "size": "xs", "color": "#cccccc" },
                                                { "type": "text", "text": `${sign}${userTotalWinLoss} บาท`, "size": "xs", "color": displayColor, "align": "end", "weight": "bold" }
                                            ]
                                        },
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "contents": [
                                                { "type": "text", "text": `• เครดิตคงเหลือ:`, "size": "xs", "color": "#cccccc" },
                                                { "type": "text", "text": `${user.balance} บ.`, "size": "xs", "color": "#ffffff", "align": "end" }
                                            ]
                                        },
                                        { "type": "separator", "color": "#2a2233", "margin": "xs" }
                                    ]
                                });

                            } catch (error) {
                                console.error(`❌ คิดเงินล้มเหลว uId ${uId}:`, error);
                            }    
                        }

                        await saveDataToFirebase();

                        let dealerDisplay = `${tempDealerResult.score}แต้ม`;
                        if (tempDealerResult.name.includes("ป๊อก 9")) dealerDisplay = "9ป";
                        else if (tempDealerResult.name.includes("ป๊อก 8")) dealerDisplay = "8ป";

                        let historySummary = `รอบที่ ${currentRound}: [👑${dealerDisplay}] ⚔️\n`;
                        let roomRows = [];

                        for (let leg = 1; leg <= 6; leg++) {
                            if (tempRoomResults[leg]) {
                                const legRes = tempRoomResults[leg];
                                let dotCard = "🟡";
                                if (tempDealerResult.score > legRes.card.score) dotCard = "🔴";
                                else if (tempDealerResult.score < legRes.card.score) dotCard = "🟢";

                                roomRows.push(`[${leg}${dotCard}]`);
                            } else {
                                roomRows.push(`[${leg}🔴]`);
                            }
                        }

                        historySummary += `${roomRows[0]} ${roomRows[1]} ${roomRows[2]}\n${roomRows[3]} ${roomRows[4]} ${roomRows[5]}`;
                        
                        matchHistory.push(historySummary);
                        if (matchHistory.length > 5) matchHistory.shift(); 

                        pastRoundsData[currentRound] = {
                            dealer: JSON.parse(JSON.stringify(tempDealerResult)),
                            rooms: JSON.parse(JSON.stringify(tempRoomResults)),
                            bets: JSON.parse(JSON.stringify(roundBets))
                        };
                        
                        const chunkSize = 7; 
                        const userPages = [];
                        for (let i = 0; i < flexUserContents.length; i += chunkSize) {
                            userPages.push(flexUserContents.slice(i, i + chunkSize));
                        }

                        if (userPages.length === 0) {
                            userPages.push([{ "type": "text", "text": "ไม่มีรายการคำนวณในรอบนี้", "color": "#aaaaaa", "size": "xs", "align": "center" }]);
                        }

                        const winLossBubbles = userPages.map((pageContents, index) => ({
                            "type": "bubble",
                            "styles": { "body": { "backgroundColor": "#191424" } },
                            "body": {
                                "type": "box", "layout": "vertical", "spacing": "md",
                                "contents": [
                                    { "type": "text", "text": "💰 สรุปยอดได้/เสีย ประจำรอบ 🎉", "weight": "bold", "color": "#ffaa00", "size": "md", "align": "center" },
                                    { "type": "text", "text": `รอบที่: ${currentRound} (หน้า ${index + 1}/${userPages.length})`, "weight": "bold", "color": "#ffffff", "size": "xl", "align": "center" },
                                    { "type": "text", "text": `👑 เจ้ามือ: ${tempDealerResult.name}`, "size": "xs", "color": "#aaaaaa", "align": "center" },
                                    { "type": "separator", "color": "#2a2a35" },
                                    { "type": "box", "layout": "vertical", "spacing": "sm", "contents": pageContents },
                                    { "type": "separator", "color": "#2a2a35" },
                                    { "type": "text", "text": "✅ เคลียร์ยอดเงินเรียบร้อยแล้วครับ!", "size": "xs", "color": "#00ff66", "align": "center", "weight": "bold" }
                                ]
                            }
                        }));

                        try {
                            await axios.post('https://api.line.me/v2/bot/message/reply', {
                                replyToken: replyToken,
                                messages: [{
                                    "type": "flex",
                                    "altText": `💰 สรุปยอดได้/เสีย รอบที่: ${currentRound}`,
                                    "contents": { "type": "carousel", "contents": winLossBubbles }
                                }]
                            }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                        } catch (err) {
                            console.error("❌ ยิง Flex สรุปยอดล้มเหลว:", err.message);
                        }

                        tempRoomResults = null;
                        tempDealerResult = null;
                        roundBets = {};
                        return res.sendStatus(200);
                    }     
                    else if (userMsg === 'no') {
                        replyText = "❌ ยกเลิกผลคำนวณรอบนี้เรียบร้อย ส่งแต้มเข้ามาใหม่ได้เลยครับ";
                        tempRoomResults = null;
                        tempDealerResult = null;
                    }
                }
            }
            // 10. ระบบคู่มือ (คส, กต, บช)
            else if (userMsg === 'คส' || userMsg === 'กต' || userMsg === 'บช' || userMsg === '/บช') {
                if (userMsg === 'คส') {
                    replyText = `📜 **[ คู่มือคำสั่งสมาชิก ]** 📜\n\n` +
                                `🔹 **[เลขขา]-[จำนวนเงิน]** ➡️ ส่งโพยเดิมพัน (เช่น 123-100)\n` +
                                `🔹 **รข-[จำนวนเงิน]** ➡️ แทงเหมาหมดทุกขา ขาละเท่าๆ กัน\n` +
                                `🔹 **รจ-[จำนวนเงิน]** ➡️ แทงเจ้ามือสู้ทุกขา\n` +
                                `🔹 **R** ➡️ ยกเลิกโพยในรอบ\n` +
                                `🔹 **ฝาก[จำนวนเงิน]** ➡️ แจ้งฝากเงินระบบออโต้`;
                } else if (userMsg === 'กต') {
                    replyText = `💡 พิมพ์ "คส" เพื่อดูวิธีการส่งโพยครับ`;
                } else if (userMsg === 'บช' || userMsg === '/บช') {
                    replyText = `🏦 [ กรุณาพิมพ์ ฝากตามด้วยจำนวนเงิน เช่น ฝาก 500 ] 🏦`;
                }
            }
            // ดึงโพยและผลไพ่ย้อนหลัง (vรอบ,mสมาชิก)
            else if (userMsg.startsWith('v') && userMsg.includes(',m')) {
                const parts = userMsg.split(',');
                const roundTarget = parseInt(parts[0].replace('v', '')); 
                const memberTarget = parseInt(parts[1].replace('m', '')); 

                if (isNaN(roundTarget) || isNaN(memberTarget)) {
                    replyText = "⚠️ พิมพ์รูปแบบ เช่น v12,m5";
                } else if (!pastRoundsData[roundTarget]) {
                    replyText = `❌ ไม่พบข้อมูลการเล่นของ "รอบที่ ${roundTarget}" ในระบบครับ`;
                } else {
                    const historicalRound = pastRoundsData[roundTarget];
                    const historicalDealer = historicalRound.dealer;
                    const historicalRooms = historicalRound.rooms;
                    const historicalBets = historicalRound.bets;

                    let targetUid = null;
                    for (let uid in historicalBets) {
                        if (historicalBets[uid][0] && historicalBets[uid][0].memberNumber === memberTarget) {
                            targetUid = uid;
                            break;
                        }
                    }

                    if (!targetUid || !historicalBets[targetUid] || historicalBets[targetUid].length === 0) {
                        replyText = `❌ ไม่พบโพยของ สมาชิกคนที่ ${memberTarget} ในรอบที่ ${roundTarget}`;
                    } else {
                        const userBets = historicalBets[targetUid];
                        const userName = userBets[0].name;

                        let reportText = `🔍 ข้อมูลโพยย้อนหลัง รอบที่ ${roundTarget}\n👤 สมาชิกคนที่ ${memberTarget} (${userName})\n──────────────────\n`;
                        reportText += `👑 เจ้ามือ: ${historicalDealer.name} (${historicalDealer.mult} เด้ง)\n──────────────────\n`;

                        for (let leg = 1; leg <= 6; leg++) {
                            if (historicalRooms[leg]) {
                                const res = historicalRooms[leg];
                                let status = res.card.score > historicalDealer.score ? "🟢 ชนะ" : (res.card.score < historicalDealer.score ? "🔴 แพ้" : "🟡 เสมอ");
                                reportText += `• ขา ${leg}: ${res.card.name} (${res.card.mult}เด้ง) ${status}\n`;
                            } else {
                                reportText += `• ขา ${leg}: ⚠️ ไม่มีผลไพ่ (🔴 แพ้เจ้า)\n`;
                            }
                        }

                        replyText = reportText;
                    }
                }
            }
            // ระบบถอนเงิน (ถอน500)
            else if (userMsg.startsWith('ถอน')) {
                const user = usersWallets[userId];
                if (!user) {
                    replyText = "⚠️ คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบครับ";
                } else if (user.isWithdrawLocked) {
                    replyText = `❌ มีรายการแจ้งถอนค้างอยู่จำนวน ${user.pendingWithdrawAmount} บาท รอแอนมินอนุมัติครับ`;
                } else if (user.turnoverTarget > 0) {
                    replyText = `❌ ยอดเทิร์นคงค้างที่ต้องเล่นเพิ่ม: ${user.turnoverTarget} บาท จึงจะถอนเงินได้ครับ`;
                } else {
                    const withdrawAmount = parseInt(userMsg.replace('ถอน', '').trim());

                    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
                        replyText = "⚠️ กรุณาพิมพ์ระบุจำนวนเงิน เช่น ถอน500";
                    } else if (user.balance < withdrawAmount) {
                        replyText = `❌ เครดิตไม่เพียงพอ (เครดิตปัจจุบัน: ${user.balance} บาท)`;
                    } else {
                        user.isWithdrawLocked = true;
                        user.pendingWithdrawAmount = withdrawAmount;

                        withdrawQueue.push({ 
                            memberNumber: user.memberNumber, 
                            name: user.name, 
                            amount: withdrawAmount, 
                            time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) 
                        });
                        
                        await saveDataToFirebase();
                        replyText = `✅ บันทึกรายการแจ้งถอน ${withdrawAmount} บาท เรียบร้อยแล้ว กรุณารอแอดมินอนุมัติสักครู่ครับ`;
                    }
                }
            }

            // ตอบกลับข้อความทั่วไป
            if (replyText !== "") {
                try {
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [{ type: 'text', text: replyText }]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });
                } catch (error) {
                    console.error("❌ ตอบกลับข้อความล้มเหลว:", error.message);
                }
            }
        }
    }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(` Server running on port ${PORT}`));
