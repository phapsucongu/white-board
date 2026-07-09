import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type CommentSummary, type RoomMember, type RoomSummary, type VersionHistory } from '../api/client';

export function useRoom(roomId: string | undefined, accessToken: string | null) {
  return useQuery({
    queryKey: ['room', roomId],
    queryFn: () => apiClient.getRoom(roomId!, accessToken!),
    enabled: !!roomId && !!accessToken
  });
}

export function useBoardSnapshot(roomId: string | undefined, accessToken: string | null) {
  return useQuery({
    queryKey: ['board', roomId],
    queryFn: () => apiClient.getBoardSnapshot(roomId!, accessToken!),
    enabled: !!roomId && !!accessToken
  });
}

export function useVersionHistory(roomId: string | undefined, accessToken: string | null) {
  return useQuery({
    queryKey: ['versions', roomId],
    queryFn: () => apiClient.getVersionHistory(roomId!, accessToken!),
    enabled: !!roomId && !!accessToken
  });
}

export function useComments(roomId: string | undefined, accessToken: string | null) {
  return useQuery({
    queryKey: ['comments', roomId],
    queryFn: () => apiClient.listComments(roomId!, accessToken!),
    enabled: !!roomId && !!accessToken
  });
}

export function useCreateComment(roomId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ body, accessToken }: { body: string; accessToken: string }) =>
      apiClient.createComment(roomId!, { body }, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', roomId] });
    }
  });
}

export function useUpdateComment(roomId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ commentId, resolved, accessToken }: { commentId: string; resolved: boolean; accessToken: string }) =>
      apiClient.updateComment(roomId!, commentId, { resolved }, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', roomId] });
    }
  });
}

export function useMembers(roomId: string | undefined, accessToken: string | null) {
  return useQuery({
    queryKey: ['members', roomId],
    queryFn: () => apiClient.listMembers(roomId!, accessToken!),
    enabled: !!roomId && !!accessToken
  });
}

export function useUpdateMemberRole(roomId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, role, accessToken }: { userId: string; role: 'OWNER' | 'EDITOR' | 'VIEWER'; accessToken: string }) =>
      apiClient.updateMemberRole(roomId!, userId, role, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', roomId] });
    }
  });
}

export function useRemoveMember(roomId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, accessToken }: { userId: string; accessToken: string }) =>
      apiClient.removeMember(roomId!, userId, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', roomId] });
    }
  });
}

export function useRooms(accessToken: string | null) {
  return useQuery({
    queryKey: ['rooms'],
    queryFn: () => apiClient.listRooms(accessToken!),
    enabled: !!accessToken
  });
}

export function useCreateRoom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, accessToken }: { name: string; accessToken: string }) =>
      apiClient.createRoom({ name }, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
    }
  });
}

export function useDeleteRoom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ roomId, accessToken }: { roomId: string; accessToken: string }) =>
      apiClient.deleteRoom(roomId, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
    }
  });
}

export function useJoinRoom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ inviteCode, accessToken }: { inviteCode: string; accessToken: string }) =>
      apiClient.joinByInviteCode(inviteCode, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
    }
  });
}

export function useCreateVersionTag(roomId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ version, label, accessToken }: { version: number; label: string; accessToken: string }) =>
      apiClient.createVersionTag(roomId!, { version, label }, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['versions', roomId] });
    }
  });
}

export function useRestoreVersion(roomId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ version, accessToken }: { version: number; accessToken: string }) =>
      apiClient.restoreVersion(roomId!, version, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['versions', roomId] });
      queryClient.invalidateQueries({ queryKey: ['board', roomId] });
    }
  });
}
