/**
 * Passport Configuration
 * Sets up OAuth2 strategies (Google, GitHub)
 */

const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;

const { User } = require('./models');
const config = require('./index');
const logger = require('../utils/logger');

/**
 * Local Strategy (email + password)
 */
passport.use(
  new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
    },
    async (email, password, done) => {
      try {
        const user = await User.findOne({ email }).select('+passwordHash');

        if (!user) {
          return done(null, false, {
            message: 'Invalid email or password',
          });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
          return done(null, false, {
            message: 'Invalid email or password',
          });
        }

        return done(null, user);
      } catch (error) {
        logger.error('Local strategy error', { errorMessage: error.message });
        return done(error);
      }
    }
  )
);

/**
 * Google OAuth2 Strategy
 */
if (config.oauth.google.clientId) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.oauth.google.clientId,
        clientSecret: config.oauth.google.clientSecret,
        callbackURL: '/api/v1/auth/google/callback',
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          // Find or create user
          let user = await User.findOne({ googleId: profile.id });

          if (!user) {
            // Check if email already exists
            user = await User.findOne({ email: profile.emails?.[0]?.value });

            if (user) {
              // Link Google account to existing user
              user.googleId = profile.id;
              user.oauthProvider = 'google';
              if (!user.profileImage && profile.photos?.[0]?.value) {
                user.profileImage = profile.photos[0].value;
              }
              if (!user.firstName && profile.name?.givenName) {
                user.firstName = profile.name.givenName;
              }
              if (!user.lastName && profile.name?.familyName) {
                user.lastName = profile.name.familyName;
              }
            } else {
              // Create new user from Google profile
              user = new User({
                email: profile.emails?.[0]?.value,
                googleId: profile.id,
                firstName: profile.name?.givenName || profile.displayName,
                lastName: profile.name?.familyName || '',
                profileImage: profile.photos?.[0]?.value,
                emailVerified: true, // Google accounts are already verified
                oauthProvider: 'google',
                passwordHash: 'oauth', // Not used for OAuth users
              });
            }
          }

          await user.save();

          logger.info('Google OAuth user authenticated', {
            userId: user._id,
            email: user.email,
          });

          return done(null, user);
        } catch (error) {
          logger.error('Google strategy error', { errorMessage: error.message });
          return done(error);
        }
      }
    )
  );
}

/**
 * GitHub OAuth2 Strategy
 */
if (config.oauth.github.clientId) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: config.oauth.github.clientId,
        clientSecret: config.oauth.github.clientSecret,
        callbackURL: '/api/v1/auth/github/callback',
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          // Find or create user
          let user = await User.findOne({ githubId: profile.id });

          if (!user) {
            // Try to find by email if profile contains primary email
            const email = profile.emails?.find((e) => e.primary)?.value || profile.emails?.[0]?.value;

            if (email) {
              user = await User.findOne({ email });
            }

            if (user) {
              // Link GitHub account to existing user
              user.githubId = profile.id;
              user.oauthProvider = 'github';
              if (!user.profileImage && profile.photos?.[0]?.value) {
                user.profileImage = profile.photos[0].value;
              }
              if (!user.firstName && profile.displayName) {
                const names = profile.displayName.split(' ');
                user.firstName = names[0];
                if (names.length > 1) {
                  user.lastName = names.slice(1).join(' ');
                }
              }
            } else {
              // Create new user from GitHub profile
              user = new User({
                email: email || `${profile.username}@github.local`, // Fallback if no email
                githubId: profile.id,
                firstName: profile.displayName || profile.username,
                profileImage: profile.photos?.[0]?.value,
                emailVerified: !!email, // Only if we got an actual email
                oauthProvider: 'github',
                passwordHash: 'oauth', // Not used for OAuth users
              });
            }
          }

          await user.save();

          logger.info('GitHub OAuth user authenticated', {
            userId: user._id,
            email: user.email,
          });

          return done(null, user);
        } catch (error) {
          logger.error('GitHub strategy error', { errorMessage: error.message });
          return done(error);
        }
      }
    )
  );
}

/**
 * Serialize user for session storage
 */
passport.serializeUser((user, done) => {
  done(null, user.id);
});

/**
 * Deserialize user from session
 */
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    logger.error('Deserialize user error', { errorMessage: error.message });
    done(error);
  }
});

module.exports = passport;
