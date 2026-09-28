const navLinks = document.querySelectorAll('.nav-link[data-view]');
const pages = document.querySelectorAll('.page-view');

function showPage(pageName) {
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

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

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
    .select('full_name, faculty_id, programme_id')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    facultyDisplay.textContent = 'Profile details could not be loaded.';
    programmeDisplay.textContent = 'Profile details could not be loaded.';
    console.error('Could not load student profile:', profileError);
    if (greetingDisplay) greetingDisplay.textContent = 'Student';
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