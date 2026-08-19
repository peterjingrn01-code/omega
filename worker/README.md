# ΩPair — JOFP 点对点文件分享

这次加的是好友之间**直接点对点**分享文件和图片——文件不经过任何服务器存储,只在你和好友的浏览器之间直接传输。之前那版基于 Cloudflare R2 的"发帖带附件"功能已经被这个替代,不再使用 R2。

## 这次多了一个新东西:Durable Object

之前用过 D1(数据库)、R2(文件存储,现在不用了)。这次要用的叫 **Durable Object**,作用是帮两个浏览器"牵线"——只负责说"你朋友在线,你们可以直接建立连接了",不存文件、不存任何持久数据,纯粹是个实时的"接线员"。免费额度很大(每月大概 300 万次请求),个人使用完全够,不需要额外付费。

## 部署顺序(这次顺序很重要,不要跳步)

### 第一步:数据库(D1 Console)

跑这一条:

```sql
CREATE TABLE IF NOT EXISTS jofp_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  omega_hash TEXT NOT NULL,
  from_identity_id INTEGER NOT NULL,
  to_identity_id INTEGER NOT NULL,
  file_name TEXT,
  file_type TEXT,
  file_size INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (from_identity_id) REFERENCES identities(id),
  FOREIGN KEY (to_identity_id) REFERENCES identities(id)
);
```

再跑一条:

```sql
CREATE INDEX IF NOT EXISTS idx_jofp_grants_to ON jofp_grants (to_identity_id, created_at DESC);
```

### 第二步:后端代码(Cloudflare Worker)

Workers & Pages → `omegapair-api` → **Edit code** → 全选删除 → 贴入 `worker-index.js` 完整内容 → **Deploy**。

**这一步一定要先做完、部署成功,再做下一步**——因为下一步要绑定的"类"(`JofpHub`)必须先出现在已部署的代码里,Cloudflare 才能找到它。

### 第三步:新建 Durable Object 绑定

1. 还是在 `omegapair-api` 这个 Worker 页面 → **Bindings** 标签
2. 点 **Add binding**
3. 这次类型选 **Durable Object**(不是 D1、也不是 R2)
4. **Variable name** 填 **`JOFP_HUB`**(必须完全是这个,大写,代码里写死的)
5. **Class name** 选 **`JofpHub`**(如果第二步代码已经部署成功,这里应该能在下拉列表里直接选到;如果看不到,说明第二步的代码没有真正部署上,回去确认一下)
6. 如果界面上问你存储类型(storage backend),选 **SQLite**(免费版只支持这个)
7. 保存,如果保存完提示需要重新部署,就再点一次 **Deploy**

### 第四步:前端(GitHub)

`index.html` 上传到 `omega` 仓库根目录,替换现有文件。

## 怎么用

1. 打开 **Friends** 面板,好友列表里每个好友名字旁边多了个 **📤** 按钮
2. 点它,选一个文件(图片、PDF、文档都行,单个最大 50MB),点 Send
3. 这一步只是"贴标签"——文件其实还留在你自己的浏览器里,没有真的发出去
4. 好友那边 Friends 面板下方多了个 **"Shared with me"** 区域,能看到你分享的东西,点 **Get** 才会真正触发点对点传输
5. **这一刻,你的浏览器必须开着、还留在这个网页上**,文件才能真的传过去——这是这套设计本身的取舍(之前讨论过很多轮确认过的),不是 bug

## 如实说明的限制

- **双方必须同时在线**(都开着 omega.jsl-ian.com 这个页面),离线的话对方点 Get 会提示"不在线,等TA上线再试"
- **没有做中继(TURN)服务器**——大多数家庭 WiFi、手机流量能直连成功,但少数比较严格的公司网络、某些运营商网络可能会连不上。如果以后发现经常连不上,可以再加 Cloudflare 的 TURN 中继服务(免费额度每月 1000GB,基本用不到收费),这个可以之后再说
- **50MB 文件大小上限**——是为了避免浏览器内存吃不消,不是随便定的
- **关掉浏览器标签页,分享记录还在**(数据库里留着那条"标签"),但下次要传输,还是得等分享方重新上线
- 这套机制目前是**发送方分享给接收方**这个方向;"接收方拿到后自动变成新的可分享源"这个想法讨论过,但这次还没实现——现在收到的文件只能查看/下载,还不能直接从收件箱再转发给别人。如果需要这个功能,可以下次再加。
