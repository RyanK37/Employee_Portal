// chat.js

(function(){
  let currentUser = null;
  let chatMode = 'public'; // 'public' or 'private'
  let privateWith = null;   // uid of other user in private mode
  const messagesDiv = document.getElementById('messages');
  const sendBtn = document.getElementById('sendBtn');
  const messageInput = document.getElementById('messageInput');
  const usersList = document.getElementById('usersList');
  const topNameChat = document.getElementById('topNameChat');
  const topEmailChat = document.getElementById('topEmailChat');
  const topAvatarChat = document.getElementById('topAvatarChat');
  const navLogout = document.getElementById('nav-logout-2');

  navLogout.addEventListener('click', async (e) => {
    e.preventDefault();
    await auth.signOut();
    window.location.href = "login.html";
  });

  auth.onAuthStateChanged(async (u) => {
    if (!u) {
      window.location.href = "login.html";
      return;
    }
    currentUser = u;
    topNameChat.textContent = u.displayName || u.email;
    topEmailChat.textContent = u.email;
    // load users
    loadUsers();
    // start listening public chat by default
    listenPublic();
  });

  // load all users (basic)
  async function loadUsers(){
    usersList.innerHTML = '<div class="small-muted">Loading users...</div>';
    const snap = await db.collection('users').get();
    usersList.innerHTML = '';
    snap.forEach(doc => {
      const d = doc.data();
      const uid = doc.id;
      if (uid === currentUser.uid) return; // skip self
      const div = document.createElement('div');
      div.className = 'user-item';
      div.innerHTML = `<img src="${d.profileImage || '../css/placeholder-avatar.png'}" style="width:36px;height:36px;border-radius:8px;object-fit:cover">
                       <div>
                         <div style="font-weight:600">${d.name || d.email}</div>
                         <div class="small-muted">${d.jobTitle || ''}</div>
                       </div>`;
      div.addEventListener('click', () => {
        // switch to private chat with this uid
        chatMode = 'private';
        privateWith = uid;
        messagesDiv.innerHTML = '';
        listenPrivate(uid);
      });
      usersList.appendChild(div);
    });

    // add "Public chat" pseudo-item
    const publicBtn = document.createElement('div');
    publicBtn.className = 'user-item';
    publicBtn.innerHTML = `<div style="font-weight:700">Public Chat</div>`;
    publicBtn.addEventListener('click', () => {
      chatMode = 'public';
      privateWith = null;
      messagesDiv.innerHTML = '';
      listenPublic();
    });
    usersList.prepend(publicBtn);
  }

  // LISTEN public messages
  let publicUnsub = null;
  function listenPublic(){
    if (publicUnsub) publicUnsub();
    publicUnsub = db.collection('messages').orderBy('timestamp').limit(200)
      .onSnapshot(snapshot => {
        messagesDiv.innerHTML = '';
        snapshot.forEach(doc => {
          const m = doc.data();
          appendMessage(m, m.uid === currentUser.uid);
        });
        scrollToBottom();
      });
  }

  // LISTEN private
  let privateUnsub = null;
  function listenPrivate(otherUid){
    if (privateUnsub) privateUnsub();
    // two-way path: messages are under users/{uid}/chats/{otherUid}/messages
    const path = db.collection('users').doc(currentUser.uid)
      .collection('chats').doc(otherUid).collection('messages').orderBy('timestamp');

    privateUnsub = path.onSnapshot(snapshot => {
      messagesDiv.innerHTML = '';
      snapshot.forEach(doc => {
        const m = doc.data();
        appendMessage(m, m.from === currentUser.uid);
      });
      scrollToBottom();
    });
  }

  // send message
  sendBtn.addEventListener('click', async () => {
    const text = messageInput.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    try {
      if (chatMode === 'public') {
        await db.collection('messages').add({
          text,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          uid: currentUser.uid,
          name: currentUser.displayName || currentUser.email
        });
      } else if (chatMode === 'private' && privateWith) {
        const msg = {
          text,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          from: currentUser.uid,
          to: privateWith,
          name: currentUser.displayName || currentUser.email
        };
        // write to both participants for simplicity
        const a = db.collection('users').doc(currentUser.uid)
          .collection('chats').doc(privateWith).collection('messages').doc();
        const b = db.collection('users').doc(privateWith)
          .collection('chats').doc(currentUser.uid).collection('messages').doc();
        const batch = db.batch();
        batch.set(a, msg);
        batch.set(b, msg);
        await batch.commit();
      }
      messageInput.value = '';
    } catch (err) {
      console.error(err);
      alert('Error sending message: ' + err.message);
    } finally {
      sendBtn.disabled = false;
    }
  });

  // helper to append message
  function appendMessage(m, isSelf){
    const div = document.createElement('div');
    div.className = 'msg ' + (isSelf ? 'me' : 'their');
    const header = document.createElement('div');
    header.style.fontSize = '12px';
    header.style.marginBottom = '6px';
    header.className = 'small-muted';
    header.textContent = (m.name || m.uid || 'User') + (m.timestamp && m.timestamp.toDate ? ' • ' + m.timestamp.toDate().toLocaleTimeString() : '');
    const body = document.createElement('div');
    body.textContent = m.text;
    div.appendChild(header);
    div.appendChild(body);
    messagesDiv.appendChild(div);
  }

  function scrollToBottom(){
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
})();
