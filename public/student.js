const navLinks = document.querySelectorAll('.nav-link[data-view]');
const pages = document.querySelectorAll('.page-view');

function showPage(pageName, updateHistory = true) {
  if (![...pages].some((page) => page.dataset.page === pageName)) return;

  pages.forEach((page) => {
    page.hidden = page.dataset.page !== pageName;
  });

  navLinks.forEach((link) => {
    const active = link.dataset.view === pageName;
    link.classList.toggle('active', active);

    if (active) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  if (updateHistory && history.state?.fyeDashboardView !== pageName) {
    history.pushState({ fyeDashboardView: pageName }, '', `#${pageName}`);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const initialView = [...pages].some((page) => page.dataset.page === location.hash.slice(1))
  ? location.hash.slice(1)
  : 'overview';
history.replaceState({ fyeDashboardView: initialView }, '', `#${initialView}`);
showPage(initialView, false);
window.addEventListener('popstate', (event) => {
  const view = event.state?.fyeDashboardView || 'overview';
  showPage(view, false);
});

navLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    showPage(link.dataset.view);
  });
});

document.querySelectorAll('[data-go]').forEach((button) => {
  button.addEventListener('click', () => showPage(button.dataset.go));
});

const fyeClient = window.fyeSupabase;
const mentorSection = document.querySelector('[data-page="mentor"]');
const mentorDetails = mentorSection?.querySelector('.mentor-detail');
const contactPanel = mentorSection?.querySelector(
  '.content-panel:not(.mentor-detail)'
);
const overviewMentorCard = document.querySelector(
  '[data-page="overview"] .mentor-card'
);

const mentorStatus = document.createElement('p');
mentorStatus.className = 'summary-text';
mentorStatus.textContent = 'Loading your assigned mentor…';

if (mentorDetails) {
  mentorDetails.before(mentorStatus);
  mentorDetails.hidden = true;
}

if (contactPanel) {
  contactPanel.hidden = true;
}

function getInitials(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'M';
}

function showNoMentor(message) {
  mentorStatus.textContent = message;

  if (mentorDetails) mentorDetails.hidden = true;
  if (contactPanel) contactPanel.hidden = true;

  if (overviewMentorCard) {
    const heading = overviewMentorCard.querySelector('h3');
    const summary = overviewMentorCard.querySelector('.summary-text');

    if (heading) heading.textContent = 'No mentor assigned yet';
    if (summary) {
      summary.textContent = 'Your supervisor will assign your mentor.';
    }
  }
}

async function loadAssignedMentor() {
  if (!fyeClient) {
    showNoMentor('The Supabase connection did not load. Please refresh the page.');
    return;
  }

  try {
    const { data: authData, error: authError } =
      await fyeClient.auth.getUser();

    if (authError || !authData.user) {
      showNoMentor('Please sign in again to view your assigned mentor.');
      return;
    }

    const { data: account, error: accountError } = await fyeClient
      .from('profiles')
      .select('is_active')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (accountError || account?.is_active === false) {
      await fyeClient.auth.signOut();
      window.location.replace('index.html');
      return;
    }

    const { data: assignment, error: assignmentError } = await fyeClient
      .from('mentor_assignments')
      .select('mentor_id, assigned_at')
      .eq('student_id', authData.user.id)
      .is('ended_at', null)
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (assignmentError) {
      console.error('Could not load mentor assignment:', assignmentError);
      showNoMentor('We could not load your mentor assignment. Please try again.');
      return;
    }

    if (!assignment) {
      showNoMentor('No active mentor assignment is available for your account yet.');
      return;
    }

    const { data: mentor, error: mentorError } = await fyeClient
      .from('profiles')
      .select(
        'id, full_name, email, faculty_id, bio, avatar_path, whatsapp_group_link'
      )
      .eq('id', assignment.mentor_id)
      .single();

    if (mentorError || !mentor) {
      console.error('Could not load mentor profile:', mentorError);
      showNoMentor('Your assignment was found, but we could not load the mentor profile.');
      return;
    }

    const mentorName = mentor.full_name || 'Your mentor';
    const mentorFaculty = document.querySelector('#student-mentor-faculty');
    const mentorNameElement = document.querySelector('#student-mentor-name');
    const mentorIntro = document.querySelector('#student-mentor-intro');
    const initials = document.querySelector('#student-mentor-initials');
    const photo = document.querySelector('#student-mentor-photo');
    const whatsapp = document.querySelector('#student-whatsapp-link');

    if (mentorNameElement) mentorNameElement.textContent = mentorName;
    if (mentorIntro) {
      mentorIntro.textContent = mentor.bio || 'Your mentor is here to support you.';
    }

    if (mentor.faculty_id) {
      const { data: faculty } = await fyeClient
        .from('faculties')
        .select('name')
        .eq('id', mentor.faculty_id)
        .maybeSingle();

      if (mentorFaculty) {
        mentorFaculty.textContent = faculty?.name || 'Faculty not listed';
      }
    } else if (mentorFaculty) {
      mentorFaculty.textContent = 'Faculty not listed';
    }

    if (initials) {
      initials.textContent = getInitials(mentorName);
      initials.hidden = false;
    }

    if (photo) {
      photo.hidden = true;
      photo.removeAttribute('src');

      if (mentor.avatar_path) {
        const { data: photoData, error: photoError } = await fyeClient.storage
          .from('mentor-photos')
          .createSignedUrl(mentor.avatar_path, 3600);

        if (!photoError && photoData?.signedUrl) {
          photo.src = photoData.signedUrl;
          photo.hidden = false;
          if (initials) initials.hidden = true;
        }
      }
    }

    if (whatsapp) {
      const groupLink = mentor.whatsapp_group_link || '';

      if (groupLink.startsWith('https://chat.whatsapp.com/')) {
        whatsapp.href = groupLink;
        whatsapp.hidden = false;
      } else {
        whatsapp.hidden = true;
      }
    }

    const emailLink = contactPanel?.querySelector('a[href^="mailto:"]');

    if (emailLink && mentor.email) {
      emailLink.href = `mailto:${mentor.email}`;
      const emailLabel = emailLink.querySelector('span');
      if (emailLabel) emailLabel.textContent = `Email ${mentorName}`;
    } else if (emailLink) {
      emailLink.hidden = true;
    }

    const contactDescription = contactPanel?.querySelector('.summary-text');
    if (contactDescription) {
      contactDescription.textContent =
        `Reach out to ${mentorName} about university life, finding your way around campus, or getting connected to support.`;
    }

    if (overviewMentorCard) {
      const heading = overviewMentorCard.querySelector('h3');
      const summary = overviewMentorCard.querySelector('.summary-text');

      if (heading) heading.textContent = mentorName;
      if (summary) {
        summary.textContent = `Peer Mentor · ${mentorFaculty?.textContent || 'Faculty not listed'}`;
      }
    }

    if (mentorDetails) mentorDetails.hidden = false;
    if (contactPanel) contactPanel.hidden = false;
    mentorStatus.textContent = 'Your assigned mentor profile is loaded.';
  } catch (error) {
    console.error('Error loading assigned mentor:', error);
    showNoMentor('Something went wrong while loading your mentor. Please refresh the page.');
  }
}

loadAssignedMentor();
async function loadStudentStudyDetails() {
  const facultyDisplay = document.querySelector('#student-faculty');
  const programmeDisplay = document.querySelector('#student-programme');
  const greetingDisplay = document.querySelector('#student-greeting-name');
  if (!facultyDisplay || !programmeDisplay) return;
  if (!window.fyeSupabase) {
    facultyDisplay.textContent = 'Could not connect to the database.';
    programmeDisplay.textContent = 'Could not connect to the database.';
    return;
  }

  const { data: authData, error: authError } =
    await window.fyeSupabase.auth.getUser();

  if (authError || !authData.user) {
    facultyDisplay.textContent = 'Please sign in again.';
    programmeDisplay.textContent = 'Please sign in again.';
    if (greetingDisplay) greetingDisplay.textContent = 'Student';
    return;
  }

  const { data: profile, error: profileError } = await window.fyeSupabase
    .from('profiles')
    .select('full_name, faculty_id, programme_id, is_active')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    facultyDisplay.textContent = 'Profile details could not be loaded.';
    programmeDisplay.textContent = 'Profile details could not be loaded.';
    console.error('Could not load student profile:', profileError);
    if (greetingDisplay) greetingDisplay.textContent = 'Student';
    return;
  }

  if (profile.is_active === false) {
    await window.fyeSupabase.auth.signOut();
    window.location.replace('index.html');
    return;
  }

  const displayName = profile.full_name?.trim()
    || authData.user.user_metadata?.full_name?.trim()
    || authData.user.email?.split('@')[0]
    || 'Student';
  const firstName = displayName.split(/\s+/)[0];
  const profileName = document.querySelector('#student-profile-name');
  const avatar = document.querySelector('#student-avatar');
  if (greetingDisplay) greetingDisplay.textContent = firstName;
  if (profileName) profileName.textContent = displayName;
  if (avatar) {
    avatar.textContent = displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
  }

  if (!profile.faculty_id || !profile.programme_id) {
    facultyDisplay.textContent = 'Not selected';
    programmeDisplay.textContent = 'Not selected';
    return;
  }

  const [{ data: faculty }, { data: programme }] = await Promise.all([
    window.fyeSupabase
      .from('faculties')
      .select('name')
      .eq('id', profile.faculty_id)
      .maybeSingle(),

    window.fyeSupabase
      .from('programmes')
      .select('name')
      .eq('id', profile.programme_id)
      .maybeSingle()
  ]);

  facultyDisplay.textContent = faculty?.name || 'Not found';
  programmeDisplay.textContent = programme?.name || 'Not found';
}

loadStudentStudyDetails();

const nextEventTitle = document.querySelector('#next-calendar-event-title');
const nextEventDetails = document.querySelector('#next-calendar-event-details');
const openNextEventButton = document.querySelector('#open-next-calendar-event');
let nextCalendarEvent = null;

async function loadNextCalendarEvent() {
  if (!nextEventTitle || !window.fyeSupabase) return;

  const { data: events, error } = await window.fyeSupabase
    .from('calendar_events')
    .select('id, title, event_type, starts_at, location, event_status')
    .eq('event_status', 'scheduled')
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('Could not load the next calendar event:', error);
    nextEventTitle.textContent = 'Event unavailable';
    nextEventDetails.textContent = 'Could not load the calendar. Please try again later.';
    return;
  }

  nextCalendarEvent = events?.[0] || null;
  if (!nextCalendarEvent) {
    nextEventTitle.textContent = 'No upcoming events';
    nextEventDetails.textContent = 'New scheduled events will appear here.';
    return;
  }

  const startsAt = new Date(nextCalendarEvent.starts_at);
  const eventDate = new Intl.DateTimeFormat('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(startsAt);
  const eventType = nextCalendarEvent.event_type
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  nextEventTitle.textContent = nextCalendarEvent.title;
  nextEventDetails.textContent = [eventType, eventDate, nextCalendarEvent.location]
    .filter(Boolean)
    .join(' · ');
  openNextEventButton.disabled = false;
}

openNextEventButton?.addEventListener('click', () => {
  if (!nextCalendarEvent) return;
  showPage('calendar');
  window.dispatchEvent(new CustomEvent('fye:open-calendar-event', {
    detail: { id: nextCalendarEvent.id, startsAt: nextCalendarEvent.starts_at }
  }));
});

loadNextCalendarEvent();

const mentorApplicationForm = document.querySelector('#mentor-application-form');
const mentorApplicationStatus = document.querySelector('#mentor-application-status');
const academicRecordInput = document.querySelector('#mentor-academic-record');

async function loadMentorApplication() {
  if (!mentorApplicationForm || !window.fyeSupabase) return;

  const { data: authData, error: authError } = await window.fyeSupabase.auth.getUser();
  if (authError || !authData.user) {
    mentorApplicationStatus.textContent = 'Sign in again to manage your mentor application.';
    mentorApplicationForm.hidden = true;
    return;
  }

  const { data: application, error } = await window.fyeSupabase
    .from('mentor_applications')
    .select('id, status, review_reason, academic_record_path')
    .eq('applicant_id', authData.user.id)
    .maybeSingle();

  if (error) {
    console.error('Could not load mentor application:', error);
    mentorApplicationStatus.textContent = error.code === 'PGRST205'
      ? 'Mentor applications are not enabled yet. The FYE coordinator must apply the mentor application database migration.'
      : 'Could not load your mentor application. Please contact your FYE coordinator.';
    mentorApplicationForm.hidden = true;
    return;
  }

  mentorApplicationForm.hidden = false;
  if (application?.status === 'approved') {
    mentorApplicationStatus.textContent = 'Your mentor application is approved. You can sign in using Mentor.';
    mentorApplicationForm.hidden = true;
  } else if (application?.status === 'pending') {
    mentorApplicationStatus.textContent = 'Your application is pending supervisor review.';
    mentorApplicationForm.hidden = true;
  } else if (application?.status === 'declined') {
    mentorApplicationStatus.textContent = `Your application was declined: ${application.review_reason || 'No reason was provided.'} You may update the details and submit again.`;
    academicRecordInput.required = true;
  } else {
    mentorApplicationStatus.textContent = 'Complete the details below to submit your application.';
  }

  mentorApplicationForm.dataset.previousRecordPath = application?.academic_record_path || '';
}

mentorApplicationForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  mentorApplicationStatus.textContent = '';

  const db = window.fyeSupabase;
  const studentNumber = document.querySelector('#mentor-student-number').value.trim();
  const studyYear = Number(document.querySelector('#mentor-study-year').value);
  const previousAcademicYear = document.querySelector('#mentor-previous-year').value.trim();
  const file = academicRecordInput.files[0];
  const submitButton = document.querySelector('#mentor-application-submit');

  if (!Number.isInteger(studyYear) || studyYear < 2) {
    mentorApplicationStatus.textContent = 'Mentors must be in at least their second year of study.';
    return;
  }

  if (!file || file.type !== 'application/pdf' || file.size > 10 * 1024 * 1024) {
    mentorApplicationStatus.textContent = 'Choose an academic record in PDF format, up to 10 MB.';
    return;
  }

  const { data: authData, error: authError } = await db.auth.getUser();
  if (authError || !authData.user) {
    mentorApplicationStatus.textContent = 'Sign in again before submitting your application.';
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Uploading application…';

  const previousRecordPath = mentorApplicationForm.dataset.previousRecordPath;
  const recordPath = `${authData.user.id}/${crypto.randomUUID()}.pdf`;

  try {
    const { error: uploadError } = await db.storage
      .from('mentor-academic-records')
      .upload(recordPath, file, { contentType: 'application/pdf', upsert: false });

    if (uploadError) throw uploadError;

    const { error: submitError } = await db.rpc('submit_mentor_application', {
      p_student_number: studentNumber,
      p_study_year: studyYear,
      p_previous_academic_year: previousAcademicYear,
      p_academic_record_path: recordPath
    });

    if (submitError) {
      await db.storage.from('mentor-academic-records').remove([recordPath]);
      throw submitError;
    }

    if (previousRecordPath) {
      await db.storage.from('mentor-academic-records').remove([previousRecordPath]);
    }

    mentorApplicationForm.reset();
    mentorApplicationStatus.textContent = 'Your application has been submitted and is pending supervisor review.';
    await loadMentorApplication();
  } catch (error) {
    console.error('Could not submit mentor application:', error);
    mentorApplicationStatus.textContent = `Could not submit your application: ${error.message || 'Please try again.'}`;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Submit application';
  }
});

loadMentorApplication();