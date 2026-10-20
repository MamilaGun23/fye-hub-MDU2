(async () => {
  if (window.fyeAuth && !(await window.fyeAuth.ready)) return;
  const db = window.fyeSupabase;
  const page = document.querySelector('[data-page="messages"]');
  if (!db || !page) return;

  const mentorMode = location.pathname.toLowerCase().endsWith('mentor.html');
  const mentorSelect = document.querySelector('#mentor-message-student');
  const thread = document.querySelector(mentorMode ? '#mentor-message-thread' : '#student-message-thread');
  const form = document.querySelector(mentorMode ? '#mentor-message-form' : '#student-message-form');
  const messageInput = document.querySelector(mentorMode ? '#mentor-message-body' : '#student-message-body');
  const feedback = document.querySelector(mentorMode ? '#mentor-message-feedback' : '#student-message-feedback');
  let userId = null;
  let recipientId = null;
  const drafts = new Map();
  let threadLoad = 0;

  function addText(tag, className, value) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  }

  function showMessage(text) {
    thread.replaceChildren(addText('p', 'summary-text', text));
  }

  async function loadMentorStudents() {
    if (!mentorSelect) return;
    mentorSelect.replaceChildren(new Option('Choose a student', ''));
    const { data: assignments, error: assignmentError } = await db
      .from('active_mentor_assignments')
      .select('student_id')
      .eq('mentor_id', userId)
      .is('ended_at', null);
    if (assignmentError) throw assignmentError;

    const studentIds = [...new Set((assignments || []).map((row) => row.student_id))];
    if (!studentIds.length) {
      mentorSelect.replaceChildren(new Option('No assigned students yet', ''));
      showMessage('Messages will be available when students are assigned to you.');
      form.hidden = true;
      return;
    }

    const { data: students, error: studentError } = await db
      .from('profiles')
      .select('id, full_name, email')
      .in('id', studentIds)
      .order('full_name');
    if (studentError) throw studentError;

    for (const student of students || []) {
      mentorSelect.add(new Option(student.full_name || student.email || 'Student', student.id));
    }
    mentorSelect.value = students[0]?.id || '';
    mentorSelect.disabled = false;
    form.hidden = false;
    recipientId = mentorSelect.value;
  }

  async function loadStudentMentor() {
    const { data: assignment, error } = await db
      .from('active_mentor_assignments')
      .select('mentor_id')
      .eq('student_id', userId)
      .is('ended_at', null)
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!assignment) {
      showMessage('You can message your mentor after a supervisor assigns one to you.');
      form.hidden = true;
      return;
    }
    recipientId = assignment.mentor_id;
    form.hidden = false;
  }

  async function loadThread() {
    if (!recipientId) return;
    const request = ++threadLoad;
    const mentorId = mentorMode ? userId : recipientId;
    const studentId = mentorMode ? recipientId : userId;
    const { data: messages, error } = await db
      .from('mentor_student_messages')
      .select('id, sender_id, body, created_at')
      .eq('mentor_id', mentorId)
      .eq('student_id', studentId)
      .order('created_at', { ascending: true })
      .limit(100);

    if (request !== threadLoad || (mentorMode ? recipientId !== studentId : recipientId !== mentorId)) return;
    if (error) {
      console.error('Could not load messages:', error);
      showMessage(`Could not load messages: ${error.message}`);
      return;
    }

    thread.replaceChildren();
    if (!messages?.length) {
      thread.appendChild(addText('p', 'summary-text', 'No messages yet. Start the conversation with a welcome message.'));
      return;
    }
    for (const message of messages) {
      const item = document.createElement('article');
      item.className = `message-bubble${message.sender_id === userId ? ' message-own' : ''}`;
      item.append(
        addText('p', 'message-sender', message.sender_id === userId ? 'You' : 'Your ' + (mentorMode ? 'mentee' : 'mentor')),
        addText('p', 'message-body', message.body),
        addText('small', 'message-time', new Intl.DateTimeFormat('en-ZA', {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(new Date(message.created_at)))
      );
      thread.appendChild(item);
    }
    thread.scrollTop = thread.scrollHeight;
  }

  mentorSelect?.addEventListener('change', async () => {
    if (recipientId) drafts.set(recipientId, messageInput.value);
    recipientId = mentorSelect.value || null;
    messageInput.value = drafts.get(recipientId) || '';
    try {
      await loadThread();
    } catch (error) {
      feedback.textContent = `Could not load the conversation: ${error.message}`;
    }
  });

  window.addEventListener('fye:message-compose', async (event) => {
    if (!mentorMode) return;
    await ready;
    if (form.querySelector('button[type="submit"]').disabled) {
      feedback.textContent = 'Finish sending the current message before opening another conversation.';
      return;
    }
    const { studentId, introduction = '' } = event.detail || {};
    if (!studentId || ![...mentorSelect.options].some(option => option.value === studentId)) {
      feedback.textContent = 'This student is no longer available in your assigned group.';
      return;
    }
    if (recipientId) drafts.set(recipientId, messageInput.value);
    mentorSelect.value = studentId;
    recipientId = studentId;
    messageInput.value = drafts.get(studentId) || introduction;
    drafts.set(studentId, messageInput.value);
    form.hidden = false;
    feedback.textContent = introduction ? 'Review your introduction, then send it to log first contact.' : '';
    await loadThread();
    messageInput.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.textContent = '';
    if (!recipientId || !messageInput.value.trim()) {
      feedback.textContent = mentorMode ? 'Choose a student and enter a message.' : 'Enter a message for your mentor.';
      return;
    }
    const sendButton = form.querySelector('button[type="submit"]');
    if (sendButton.disabled) return;
    const sentTo = recipientId;
    sendButton.disabled = true;
    messageInput.disabled = true;
    if (mentorSelect) mentorSelect.disabled = true;
    try {
    const { error } = await db.rpc('send_mentor_student_message', {
      p_recipient_id: sentTo,
      p_body: messageInput.value.trim()
    });
    if (error) {
      console.error('Could not send message:', error);
      feedback.textContent = `Could not send message: ${error.message}`;
      return;
    }
    messageInput.value = '';
    drafts.delete(sentTo);
    feedback.textContent = 'Message sent.';
    if (mentorMode) {
      let contactError;
      try { ({error:contactError} = await db.rpc('record_mentor_contact', { p_student_id: sentTo })); }
      catch { contactError = true; }
      if (contactError) feedback.textContent = 'Message sent. The contact log could not be updated; do not resend the message.';
      else window.dispatchEvent(new CustomEvent('fye:mentor-contact-recorded'));
    }
    window.dispatchEvent(new CustomEvent('fye:counts-refresh'));
    await loadThread();
    } catch (error) {
      feedback.textContent = 'Could not finish sending the message. Check the conversation before trying again.';
    } finally {
      sendButton.disabled = false;
      messageInput.disabled = false;
      if (mentorSelect) mentorSelect.disabled = false;
    }
  });

  async function init() {
    const { data, error } = await db.auth.getUser();
    if (error || !data.user) {
      showMessage('Sign in again to use messages.');
      form.hidden = true;
      return;
    }
    userId = data.user.id;
    try {
      if (mentorMode) await loadMentorStudents();
      else await loadStudentMentor();
      if (mentorMode) recipientId = mentorSelect?.value || null;
      await loadThread();
      window.setInterval(loadThread, 10000);
    } catch (loadError) {
      console.error('Could not initialize messages:', loadError);
      showMessage(`Could not initialize messages: ${loadError.message}`);
      form.hidden = true;
    }
  }

  const ready = init();
})();
