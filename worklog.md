# Work Log

a+c+d的方案可以
用 title 去查 BPM: 如果有免費方案那就用, 使用async方式呼叫, 然後在頁面上顯示有沒有抓成功

是否同意建一張 youtube_bpm_cache 做結果快取？
duration 抓不到時，錯誤是真的擋住 還是 僅當 advisory（讓使用者自己填 end/start，且不再 disable preview）？

Spotify 從 2024 中之後對 audio-features 在某些「未經審核 app」上會回 403，需要在 dashboard 把 app 模式從 “Development” 改成 “Quota Extension”（送一個簡單的問卷說明用途），或先在 Development 模式下把要查的 user 加到「users」清單。
對於這種 server-to-server 的查 catalog tempo，Client Credentials flow 一般沒這個限制，你可以照下面流程做先試試。


若還要再進一步（例如編輯時把 end_prev_sec 吸附到格點、或自訂相位 offset），可以再開一輪需求在 Agent 裡做。


若要之後關掉 debug，可改為只在 process.env.NODE_ENV === "development" 時渲染面板。

process.env.NODE_ENV 通常不是你在專案裡手寫設定的，而是由 執行指令的環境 / 打包工具 注入的。

常見來源
Next.js（你的專案）

next dev → 多半是 development
next build / next start → 多半是 production
這些值由 Next 在編譯／啟動時寫進 bundle，不是從 .env 讀 NODE_ENV 當一般變數。
自己下指令
在 shell 裡：
NODE_ENV=production node server.js
或先 export NODE_ENV=production 再跑指令。

CI / 託管平台
例如 Vercel、Netlify 在 build 時會設成 production（依平台而定）。

和 .env 的關係
.env、.env.local 裡可以寫 NODE_ENV=...，但 Next 官方文件會提醒：不要依賴在 .env 裡改 NODE_ENV，因為 dev/build 行為主要由 CLI 決定；在應用程式裡用 process.env.NODE_ENV === 'production' 做分支即可。

若要確認你本機現在是什麼，在專案裡暫時 console.log(process.env.NODE_ENV) 或用 next dev / next build 對照即可。

http://localhost:3000/room/4898e7ba-de23-4d32-bbc5-0dac950de881
http://localhost:3000/transition?fromVideo=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DkwEZRPkAAu8%26list%3DRDkwEZRPkAAu8&toVideo=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D88wHgiUAKoI%26list%3DRD88wHgiUAKoI
http://localhost:3000/room/3a7e48e6-3177-43ea-b0f5-37f6166fe67c
