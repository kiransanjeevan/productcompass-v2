import { Link, useLocation, useNavigate } from "react-router-dom";
import { PMButton } from "@/components/ui/pm-button";
import { Compass, Settings, LogOut, User } from "lucide-react";
import { PMAvatar } from "@/components/ui/pm-avatar";
import { useAuth } from "@/contexts/AuthContext";
import { signInWithGoogle } from "@/lib/google-auth";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavbarProps {
  isAuthenticated?: boolean;
  userName?: string;
}

const Navbar = ({ isAuthenticated = false, userName = "Alex" }: NavbarProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    try {
      const result = await signInWithGoogle();
      if (result.error) {
        toast.error("Sign-in failed. Please try again.");
        console.error("OAuth error:", result.error);
        setSigningIn(false);
        return;
      }
    } catch (err) {
      toast.error("Sign-in failed. Please try again.");
      console.error("OAuth error:", err);
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    navigate("/");
  };

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const isLandingPage = location.pathname === "/";

  return (
    <nav
      className={`sticky top-0 z-40 w-full transition-all duration-200 ${
        scrolled
          ? "bg-background/95 backdrop-blur-sm border-b border-border shadow-sm"
          : "bg-background border-b border-transparent"
      }`}
    >
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to={isAuthenticated ? "/dashboard" : "/"} className="flex items-center gap-2">
            <Compass className="h-6 w-6 text-primary" />
            <span className="font-semibold text-lg text-foreground">PM Compass</span>
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-4">
            {isLandingPage && !isAuthenticated ? (
              <>
                <button
                  onClick={handleGoogleSignIn}
                  disabled={signingIn}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Sign in
                </button>
                <PMButton variant="primary" size="sm" onClick={handleGoogleSignIn} loading={signingIn}>
                  Get Started
                </PMButton>
              </>
            ) : isAuthenticated ? (
              <>
                <Link to="/settings">
                  <PMButton variant="ghost" size="sm" className="p-2">
                    <Settings className="h-5 w-5" />
                  </PMButton>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger className="focus:outline-none">
                    <PMAvatar name={userName} size="sm" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem className="gap-2">
                      <User className="h-4 w-4" />
                      <span>{userName}</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="gap-2"
                      onClick={() => navigate("/settings")}
                    >
                      <Settings className="h-4 w-4" />
                      <span>Settings</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2 text-error"
                      onSelect={() => handleSignOut()}
                    >
                      <LogOut className="h-4 w-4" />
                      <span>{signingOut ? "Signing out..." : "Sign Out"}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
