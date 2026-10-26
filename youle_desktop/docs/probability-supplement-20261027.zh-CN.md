# M1-463D 非阻塞概率与状态气泡

两端使用能力头协商独立概率补充：主结果先成功，计划下显示“模型正在分析盈利概率...”气泡，概率返回后替换；所有有效0%至100%结果展示。可选读取有界，过期／错误结束气泡，账号、运行、结果哈希及计划价位严格绑定。补充只更新消息卡片，不主动调用绘图投影、不重播正文、不再占用主运行状态；保存、激活和删除流程沿用原协议。简英繁韩日和双主题同步。

验证：专项12通过，包含延迟、有限轮询、账号切换、移除消息、历史恢复、0%与50%边界及气泡替换。扩大回归235项中225通过，10条威科夫便利贴HTML比较失败；用HEAD `8929c2d576f84b206bc389bdac490f69b6ef3cdf` 的概率／规范／便利贴模块复现相同10案例（共20张卡），结果在`.cache/probability-baseline-result.json`，未修改失败断言或相关便利贴实现。TypeScript检查及独立Vite构建通过。40组真实Electron五语×亮暗×266/410px×等待/完成布局通过，对比度≥4.5，无溢出、气泡在计划操作后，49%卡片正常替换；亮暗截图已检查。

运行证据在仓库根`.cache/probability-*.log`与客户端`.cache/probability-supplement-20261027/`。独立构建位于根`.cache/probability-async-build-20261027/`，携带同源support-bundle。未生成正式EV安装包、重启用户Windows窗口、提交推送或发布。后端设计与89项验证见规范前端仓库`youle_mas-dev/backend/docs/probability-supplement-20261027.md`。Android本机安装与414项主流程验证见移动仓库`verification/2026-10-27/probability-supplement/README.md`。
